package expo.modules.supatermrelaytunnel.core

import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Test
import org.junit.Assume.assumeTrue

class InteropTest {
  @Test
  fun realGoRelayAndNodeHost() {
    assumeTrue(System.getenv("RELAY_TEST_BINARY") != null)
    val output = File("build/interop.log")
    val process =
      ProcessBuilder("node", "../../../../../server/src/relay/testing/androidInterop.ts")
        .redirectErrorStream(true)
        .redirectOutput(output)
        .start()
    try {
      assertTrue(
        process.waitFor(180, TimeUnit.SECONDS),
        "Interop timed out; see ${output.absolutePath}",
      )
      assertEquals(0, process.exitValue(), output.readText().takeLast(12000))
      println(output.readText().takeLast(12000))
    } finally {
      if (process.isAlive) process.destroy()
    }
  }
}
