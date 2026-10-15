plugins {
  kotlin("jvm") version "2.2.0"
  application
}

repositories {
  google()
  mavenCentral()
}

kotlin { jvmToolchain(17) }

sourceSets.main { kotlin.srcDir("../src/main/java/expo/modules/supatermrelaytunnel/core") }

dependencies {
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("com.google.crypto.tink:tink-android:1.20.0")
  implementation("org.json:json:20250517")
  testImplementation(kotlin("test-junit"))
  testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

application { mainClass.set("expo.modules.supatermrelaytunnel.core.MainKt") }

tasks.test {
  inputs.dir("fixtures")
  val relayBinary = System.getenv("RELAY_TEST_BINARY").orEmpty()
  inputs.property("relayTestBinary", relayBinary)
  outputs.upToDateWhen { relayBinary.isEmpty() }
  testLogging { showStandardStreams = true }
  workingDir(projectDir)
  environment("KOTLIN_CLASSPATH", sourceSets.main.get().runtimeClasspath.asPath)
}
