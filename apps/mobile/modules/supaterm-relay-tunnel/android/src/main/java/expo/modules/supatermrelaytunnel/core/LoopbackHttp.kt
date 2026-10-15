package expo.modules.supatermrelaytunnel.core

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.net.Socket
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

internal enum class RelayFailure(status: String, val code: String) {
  HOST_OFFLINE("503 Service Unavailable", "host-offline"),
  RELAY_BUSY("503 Service Unavailable", "relay-busy"),
  TIMEOUT("504 Gateway Timeout", "relay-timeout"),
  UNREACHABLE("502 Bad Gateway", "relay-unreachable");

  val response =
    (
      "HTTP/1.1 $status\r\nX-Supaterm-Relay-Error: $code\r\nCache-Control: no-store\r\n" +
        "Connection: close\r\nContent-Length: 0\r\n\r\n"
      ).toByteArray(Charsets.ISO_8859_1)

  companion object {
    fun from(relayStatus: Int?) =
      when (relayStatus) {
        101, 404 -> HOST_OFFLINE
        429, 503 -> RELAY_BUSY
        else -> UNREACHABLE
      }
  }
}

internal object LoopbackHttp {
  fun answer(socket: Socket, failure: RelayFailure) {
    try {
      socket.soTimeout = 5_000
      socket.getOutputStream().apply {
        write(failure.response)
        flush()
      }
      socket.shutdownOutput()
      val input = socket.getInputStream()
      val buffer = ByteArray(16384)
      var budget = 1 shl 16
      while (budget > 0) {
        val count = input.read(buffer)
        if (count < 0) break
        budget -= count
      }
    } catch (_: IOException) {}
  }

  private val headerName = Regex("[a-z0-9!#$%&'*+.^_`|~-]+")
  private val decimal = Regex("[0-9]+")
  private val hexadecimal = Regex("[0-9a-fA-F]{1,15}")
  private class Head(
    val bytes: ByteArray,
    val length: Long,
    val chunked: Boolean,
    val upgrading: Boolean
  )

  fun pipe(
    input: BufferedInputStream,
    authority: String,
    upgrade: CompletableFuture<Boolean>,
    send: (ByteArray) -> Unit
  ) {
    var requests = 0
    while (true) {
      val header = readHeader(input) ?: return
      val head = parseHead(header, authority, requests)
      send(head.bytes)
      if (head.chunked) copyChunked(input, send) else copy(input, head.length, send)
      requests++
      if (head.upgrading && upgrade.get(15, TimeUnit.SECONDS)) {
        copyRemaining(input, send)
        return
      }
    }
  }

  private fun parseHead(header: ByteArray, authority: String, requests: Int): Head {
    val lines = header.toString(Charsets.ISO_8859_1).split("\r\n")
    val first = lines.first().split(' ')
    require(
      first.size == 3 && first[2] == "HTTP/1.1" &&
        first[1].startsWith("/") && !first[1].startsWith("//")
    ) { "Invalid HTTP request" }
    val fields = parseFields(lines.drop(1))
    require(fields["host"] == listOf(authority)) { "Misdirected loopback Host" }
    val forwarded = if ("cookie" in fields || "cookie2" in fields) {
      lines.filter {
        val name = it.substringBefore(':').lowercase()
        name != "cookie" && name != "cookie2"
      }.joinToString("\r\n").toByteArray(Charsets.ISO_8859_1)
    } else {
      header
    }
    return framing(forwarded, fields, requests)
  }

  private fun framing(header: ByteArray, fields: Map<String, List<String>>, requests: Int): Head {
    val length = fields["content-length"]
    val transfer = fields["transfer-encoding"]
    require(length == null || (length.size == 1 && transfer == null)) { "Ambiguous HTTP body" }
    require(transfer == null || transfer == listOf("chunked")) { "Unsupported transfer encoding" }
    val contentLength = length?.single()?.let {
      require(decimal.matches(it))
      it.toLong()
    } ?: 0
    val upgrading = fields["upgrade"] != null
    require(!upgrading || (requests == 0 && contentLength == 0L && transfer == null)) {
      "Upgrade requires a fresh connection"
    }
    return Head(header, contentLength, transfer != null, upgrading)
  }

  private fun parseFields(lines: List<String>): Map<String, List<String>> {
    val fields = LinkedHashMap<String, MutableList<String>>()
    for (line in lines.filter { it.isNotEmpty() }) {
      require(!line.startsWith(' ') && !line.startsWith('\t') && line.contains(':')) {
        "Invalid HTTP header"
      }
      val key = line.substringBefore(':').lowercase()
      require(headerName.matches(key))
      fields.getOrPut(key) { ArrayList() }.add(line.substringAfter(':').trim())
    }
    return fields
  }

  private fun copyChunked(input: BufferedInputStream, send: (ByteArray) -> Unit) {
    while (true) {
      val line = readLine(input)
      val sizeText = line.toString(Charsets.US_ASCII).trim().substringBefore(';')
      require(hexadecimal.matches(sizeText)) { "Invalid chunk" }
      val size = sizeText.toLong(16)
      send(line)
      if (size == 0L) {
        copyTrailers(input, send)
        return
      }
      copy(input, size, send)
      val crlf = byteArrayOf(input.read().toByte(), input.read().toByte())
      require(crlf.contentEquals(byteArrayOf(13, 10)))
      send(crlf)
    }
  }

  private fun copyTrailers(input: BufferedInputStream, send: (ByteArray) -> Unit) {
    var bytes = 0
    while (true) {
      val trailer = readLine(input)
      bytes += trailer.size
      require(bytes <= 65536)
      send(trailer)
      if (trailer.size == 2) return
    }
  }

  private fun copyRemaining(input: BufferedInputStream, send: (ByteArray) -> Unit) {
    val buffer = ByteArray(65500)
    while (true) {
      val count = input.read(buffer)
      if (count < 0) return
      send(buffer.copyOf(count))
    }
  }

  private fun copy(input: BufferedInputStream, length: Long, send: (ByteArray) -> Unit) {
    var remaining = length
    val buffer = ByteArray(minOf(65500L, maxOf(1L, remaining)).toInt())
    while (remaining > 0) {
      val count = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
      if (count < 0) throw EOFException("Truncated HTTP body")
      send(buffer.copyOf(count))
      remaining -= count
    }
  }

  private fun readLine(input: BufferedInputStream): ByteArray {
    val line = ByteArrayOutputStream()
    var previous = -1
    while (line.size() <= 65536) {
      val next = input.read()
      if (next < 0) throw EOFException()
      line.write(next)
      if (previous == 13 && next == 10) return line.toByteArray()
      previous = next
    }
    error("HTTP line too large")
  }

  private fun readHeader(input: BufferedInputStream): ByteArray? {
    if (input.markSupported()) {
      input.mark(1)
      if (input.read() < 0) return null
      input.reset()
    }
    val header = ByteArrayOutputStream()
    while (header.size() <= 65536) {
      val line = readLine(input)
      header.write(line)
      if (line.size == 2) return header.toByteArray().also { require(it.size <= 65536) }
    }
    error("HTTP headers too large")
  }
}

internal class HttpUpgradeWatcher(private val upgrade: CompletableFuture<Boolean>) {
  private val header = ByteArrayOutputStream()
  private var tail = 0

  fun observe(bytes: ByteArray) {
    if (upgrade.isDone) return
    for (byte in bytes) {
      header.write(byte.toInt())
      tail = (tail shl 8) or (byte.toInt() and 255)
      if (tail == 0x0d0a0d0a) {
        val status = header.toByteArray().toString(Charsets.ISO_8859_1)
          .lineSequence().first().split(' ').getOrNull(1)
        if (status?.toIntOrNull() in 100..199 && status != "101") {
          header.reset()
        } else {
          upgrade.complete(status == "101")
          break
        }
      }
      require(header.size() <= 65536)
    }
  }
}
