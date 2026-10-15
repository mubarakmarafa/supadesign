package expo.modules.supatermrelaytunnel.core

import com.sun.management.OperatingSystemMXBean
import java.lang.management.ManagementFactory
import org.json.JSONObject

fun main(args: Array<String>) {
  val tunnel =
    NativeTunnel(
      args[0],
      args[1],
      args.getOrNull(2)?.toInt() ?: 0,
      { System.err.println("STATUS " + JSONObject(it)) },
      System.err::println,
    )
  Runtime.getRuntime().addShutdownHook(Thread { tunnel.close() })
  println("READY ${tunnel.origin}")
  System.out.flush()
  for (line in System.`in`.bufferedReader().lineSequence()) {
    if (line == "cpu") {
      val cpu =
        (ManagementFactory.getOperatingSystemMXBean() as OperatingSystemMXBean).processCpuTime
      println("CPU $cpu")
      System.out.flush()
    }
    if (line == "suspend") tunnel.suspend()
    if (line == "resume") {
      tunnel.resume()
      println("RESUMED")
      System.out.flush()
    }
    if (line == "stop") break
  }
  tunnel.close()
}
