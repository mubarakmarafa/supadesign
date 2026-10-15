package expo.modules.supatermrelaytunnel.core

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.ArrayDeque
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeoutException

internal class TunnelMux(
  private val cipher: RelayCipher,
  private val sendRecord: (ByteArray) -> Unit,
  private val schedulePump: () -> Unit,
  private val onDataSent: (Int) -> Unit,
  private val onPong: () -> Unit = {}
) {
  companion object {
    const val SESSION_WINDOW = 8 * 1024 * 1024
    const val STREAM_WINDOW = 2 * 1024 * 1024
    const val MIN_COST = 48 * 1024
    const val MAX_PLAIN = 64 * 1024
    const val MAX_IDLE_TICKS = 3

    fun frame(type: Int, id: Int, data: ByteArray = ByteArray(0)): ByteArray =
      ByteBuffer.allocate(9 + data.size)
        .put(type.toByte())
        .putInt(id)
        .putInt(data.size)
        .put(data)
        .array()

    fun window(id: Int, bytes: Int) = frame(3, id, ByteBuffer.allocate(4).putInt(bytes).array())
  }

  internal class Pending(val bytes: ByteArray, val done: CompletableFuture<Unit>) {
    var offset = 0
  }

  internal class Stream(
    val id: Int,
    val data: (ByteArray) -> Unit,
    val end: () -> Unit,
    val close: (Throwable?) -> Unit
  ) {
    val pending = ArrayDeque<Pending>()
    var unconsumed = 0
    var sendCredit = STREAM_WINDOW
    var receiveCredit = STREAM_WINDOW
    var grant = 0
    var localEnded = false
    var finSent = false
    var remoteEnded = false
    var closed = false
    val needsFin get() = localEnded && !finSent && pending.isEmpty()
    val wantsSend get() = !closed && (pending.isNotEmpty() || needsFin)
  }

  private val streams = LinkedHashMap<Int, Stream>()
  private val control = ArrayDeque<ByteArray>()
  private val ready = LinkedHashSet<Stream>()
  private var nextId = 1
  private var sendCredit = SESSION_WINDOW
  private var receiveCredit = SESSION_WINDOW
  private var grant = 0
  private var heard = false
  private var idleTicks = 0
  var closed = false
    private set

  val streamCount
    get() = streams.size

  val outstandingReceiveBytes
    get() = SESSION_WINDOW - receiveCredit - grant

  fun ping() {
    control.add(frame(6, 0))
    schedulePump()
  }

  fun open(data: (ByteArray) -> Unit, end: () -> Unit, close: (Throwable?) -> Unit): Stream {
    check(!closed && streams.size < 256 && nextId > 0) { "Tunnel stream limit reached" }
    val stream = Stream(nextId, data, end, close)
    nextId += 2
    streams[stream.id] = stream
    control.add(frame(1, stream.id))
    schedulePump()
    return stream
  }

  fun write(stream: Stream, bytes: ByteArray, done: CompletableFuture<Unit>) {
    check(!closed && !stream.closed && !stream.localEnded)
    require(bytes.size <= MAX_PLAIN)
    stream.pending.add(Pending(bytes, done))
    ready.add(stream)
    schedulePump()
  }

  fun end(stream: Stream) {
    if (closed || stream.closed) return
    stream.localEnded = true
    ready.add(stream)
    schedulePump()
  }

  fun reset(stream: Stream, error: Throwable? = null) {
    if (closed || stream.closed) return
    control.add(frame(5, stream.id))
    finish(stream, error ?: IllegalStateException("Local stream closed"))
    schedulePump()
  }

  private fun finish(stream: Stream, error: Throwable?) {
    if (stream.closed) return
    stream.closed = true
    streams.remove(stream.id)
    ready.remove(stream)
    for (pending in stream.pending) {
      pending.done.completeExceptionally(
        error ?: IllegalStateException("Stream closed")
      )
    }
    stream.pending.clear()
    release(stream.unconsumed)
    stream.unconsumed = 0
    stream.close(error)
  }

  private fun maybeFinish(stream: Stream) {
    if (stream.finSent && stream.remoteEnded && stream.unconsumed == 0) finish(stream, null)
  }

  private fun release(bytes: Int) {
    if (closed) return
    grant += bytes
    if (grant > 0 && (grant >= SESSION_WINDOW / 4 || receiveCredit < SESSION_WINDOW / 4)) {
      control.add(window(0, grant))
      receiveCredit += grant
      grant = 0
      schedulePump()
    }
  }

  fun consumed(stream: Stream, bytes: Int) {
    if (closed || stream.closed) return
    require(bytes in 1..stream.unconsumed) { "Invalid tunnel consumption" }
    stream.unconsumed -= bytes
    release(bytes)
    stream.grant += bytes
    if (stream.grant >= STREAM_WINDOW / 4) {
      control.add(window(stream.id, stream.grant))
      stream.receiveCredit += stream.grant
      stream.grant = 0
      schedulePump()
    }
    maybeFinish(stream)
  }

  fun tick() {
    if (heard) idleTicks = 0 else idleTicks++
    heard = false
    if (idleTicks >= MAX_IDLE_TICKS) throw TimeoutException("Relay session timed out")
    if (idleTicks > 0) {
      control.add(frame(6, 0))
      schedulePump()
    }
  }

  fun pump() {
    while (!closed) {
      val plain = ByteArrayOutputStream(MAX_PLAIN)
      val callbacks = ArrayList<CompletableFuture<Unit>>()
      var dataBytes = 0
      while (control.isNotEmpty() && plain.size() + control.first.size <= MAX_PLAIN) {
        plain.write(control.removeFirst())
      }
      for (stream in ready.toList()) {
        if (MAX_PLAIN - plain.size() < 9) break
        ready.remove(stream)
        dataBytes += writeStream(stream, plain, callbacks, dataBytes)
        if (stream.wantsSend) ready.add(stream)
      }
      if (plain.size() == 0) return
      flush(plain, callbacks, dataBytes)
    }
  }

  private fun writeStream(
    stream: Stream,
    plain: ByteArrayOutputStream,
    callbacks: MutableList<CompletableFuture<Unit>>,
    dataBytes: Int
  ): Int {
    val room = minOf(
      MAX_PLAIN - plain.size() - 9,
      stream.sendCredit,
      if (sendCredit >= MIN_COST) sendCredit - dataBytes else 0,
    )
    val chunk = ByteArray(minOf(room, stream.pending.sumOf { it.bytes.size - it.offset }))
    var filled = 0
    while (filled < chunk.size) {
      val pending = stream.pending.first
      val count = minOf(chunk.size - filled, pending.bytes.size - pending.offset)
      pending.bytes.copyInto(chunk, filled, pending.offset, pending.offset + count)
      pending.offset += count
      filled += count
      if (pending.offset == pending.bytes.size) {
        stream.pending.removeFirst()
        callbacks.add(pending.done)
      }
    }
    if (chunk.isNotEmpty()) {
      plain.write(frame(2, stream.id, chunk))
      stream.sendCredit -= chunk.size
    }
    if (stream.needsFin && MAX_PLAIN - plain.size() >= 9) {
      plain.write(frame(4, stream.id))
      stream.finSent = true
      maybeFinish(stream)
    }
    return chunk.size
  }

  @Suppress("TooGenericExceptionCaught")
  private fun flush(
    plain: ByteArrayOutputStream,
    callbacks: List<CompletableFuture<Unit>>,
    dataBytes: Int
  ) {
    if (dataBytes > 0) sendCredit -= maxOf(dataBytes, MIN_COST)
    try {
      sendRecord(cipher.seal(plain.toByteArray()))
    } catch (error: Exception) {
      callbacks.forEach { it.completeExceptionally(error) }
      throw error
    }
    onDataSent(dataBytes)
    callbacks.forEach { it.complete(Unit) }
  }

  private class Frame(val type: Int, val id: Int, val data: ByteArray)

  fun receive(record: ByteArray) {
    check(!closed)
    val plain = cipher.open(record)
    heard = true
    val frames = decode(ByteBuffer.wrap(plain))
    val bytes = frames.sumOf { if (it.type == 2) it.data.size else 0 }
    if (bytes > 0) {
      val cost = maxOf(bytes, MIN_COST)
      require(cost <= receiveCredit) { "Session receive window exceeded" }
      receiveCredit -= cost
      release(cost - bytes)
    }
    for (frame in frames) dispatch(frame)
  }

  private fun decode(plain: ByteBuffer): List<Frame> {
    val frames = ArrayList<Frame>()
    while (plain.hasRemaining()) {
      require(plain.remaining() >= 9) { "Truncated tunnel frame" }
      val type = plain.get().toInt() and 255
      val id = plain.int
      val size = plain.int
      require(size >= 0 && size <= plain.remaining()) { "Truncated tunnel frame" }
      val payload = ByteArray(size).also { plain.get(it) }
      require(type in 2..7) { "Unexpected tunnel frame" }
      require(type == 2 || size == if (type == 3) 4 else 0) { "Invalid control frame" }
      if (type == 2) require(size > 0 && id > 0)
      if (type >= 6) require(id == 0) { "Invalid keepalive frame" }
      frames.add(Frame(type, id, payload))
    }
    return frames
  }

  private fun dispatch(frame: Frame) {
    val stream = streams[frame.id]
    when (frame.type) {
      3 -> grantSend(stream, frame)
      2 -> deliver(stream, frame)
      4 -> if (stream != null && !stream.remoteEnded) {
        stream.remoteEnded = true
        stream.end()
        maybeFinish(stream)
      }
      5 -> if (stream != null) finish(stream, IllegalStateException("Remote stream reset"))
      6 -> {
        control.add(frame(7, 0))
        schedulePump()
      }
      7 -> onPong()
    }
  }

  private fun grantSend(stream: Stream?, frame: Frame) {
    val credit = ByteBuffer.wrap(frame.data).int
    require(credit > 0)
    if (frame.id == 0) {
      require(credit <= SESSION_WINDOW - sendCredit)
      sendCredit += credit
    } else if (stream != null) {
      require(credit <= STREAM_WINDOW - stream.sendCredit)
      stream.sendCredit += credit
    }
    schedulePump()
  }

  private fun deliver(stream: Stream?, frame: Frame) {
    if (stream == null) {
      release(frame.data.size)
    } else {
      require(!stream.remoteEnded && frame.data.size <= stream.receiveCredit) {
        "Stream receive window exceeded"
      }
      stream.receiveCredit -= frame.data.size
      stream.unconsumed += frame.data.size
      stream.data(frame.data)
    }
  }

  fun close(error: Throwable) {
    if (closed) return
    closed = true
    streams.values.toList().forEach { finish(it, error) }
    control.clear()
    ready.clear()
    cipher.destroy()
  }
}
