#!/usr/bin/env bun

import { homedir } from "os";
import { join } from "path";
import readline from "readline";
import { $, type ColorInput } from "bun";

const fileExists = (path: string) => Bun.file(path).size > 0;
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const execCommand = async (command: string) => {
  try {
    // process.env.BUN_CONFIG_VERBOSE_FETCH = "curl";
    console.log((await $`adb devices`.text()) + " which adb");
    const result = await $`
    ${{
      raw: command,
    }}
    `.throws(true);
    console.log(result);
    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: result.exitCode,
    };
  } catch (error) {
    if (error) {
      return { stdout: "", stderr: error, exitCode: 1 };
    }
    return { stdout: "", stderr: "Unknown error", exitCode: 1 };
  }
};

const question = (query: string) =>
  new Promise<string>((resolve) => rl.question(query, resolve));

let adbPath: string | null;
let debugLog = "";

function colorText(text: string, color: ColorInput) {
  return Bun.color(color, "ansi") + text + Bun.color("reset", "ansi");
}

function addToDebugLog(message: string) {
  const logMessage = `${new Date().toISOString()}: ${message}\n`;
  debugLog += logMessage;
  Bun.write("wearos_connector_debug.log ", logMessage, {
    mode: 0o777,
  });
  console.log(message);
}

async function findAdbPath() {
  try {
    const { stdout, exitCode } = await execCommand("which adb");
    console.log(stdout);
    if (exitCode === 0 && stdout.trim()) return stdout.trim();

    const commonPaths = [
      "/usr/local/bin/adb",
      "/opt/homebrew/bin/adb",
      join(homedir(), "Library/Android/sdk/platform-tools/adb"),
      join(homedir(), "Android/Sdk/platform-tools/adb"),
      "/usr/bin/adb",
    ];

    for (const path of commonPaths) {
      if (fileExists(path)) return path;
    }

    return null;
  } catch (e) {
    addToDebugLog(`Error finding ADB path: ${e}`);
    return null;
  }
}

async function isDeviceConnected() {
  try {
    const { stdout, exitCode } = await execCommand(`adb devices`);
    addToDebugLog(`ADB devices output: ${stdout}`);

    const lines = stdout.split("\n").filter((line) => line.trim() !== "");
    console.log(lines);

    return exitCode === 0 && lines.length > 1;
  } catch (e) {
    addToDebugLog(`Error checking device connection: ${e}`);
    return false;
  }
}

async function pairDevice(ipAddress: string, port: string, pairCode: string) {
  try {
    addToDebugLog("Attempting to pair device...");
    const command = `adb pair ${ipAddress}:${port} ${pairCode}`;
    addToDebugLog(`Command: ${command}`);

    const { stdout, stderr, exitCode } = await execCommand(command);
    addToDebugLog(`Stdout: ${stdout}`);
    addToDebugLog(`Stderr: ${stderr}`);
    addToDebugLog(`Exit code: ${exitCode}`);

    if (exitCode === 0) {
      console.log(colorText("Device paired successfully", "green"));
      await connectDevice(ipAddress, port);
    } else {
      console.error(colorText(`Pairing failed: ${stderr}`, "red"));
    }
  } catch (e) {
    console.error(colorText(`Error pairing device: ${e}`, "red"));
    addToDebugLog(`Exception details: ${JSON.stringify(e, null, 2)}`);
  }
}

async function connectDevice(ipAddress: string, port: string) {
  try {
    const command = `adb connect ${ipAddress}:${port}`;
    addToDebugLog(`Connecting device with command: ${command}`);
    const { stdout, stderr, exitCode } = await execCommand(command);
    addToDebugLog(`Connect stdout: ${stdout}`);
    addToDebugLog(`Connect stderr: ${stderr}`);
    addToDebugLog(`Connect exit code: ${exitCode}`);

    if (exitCode === 0) {
      console.log(colorText("Device connected successfully", "green"));
      await getInstalledApps();
      await getStorageInfo();
    } else {
      console.error(colorText(`Connection failed: ${stderr}`, "red"));
    }
  } catch (e) {
    console.error(colorText(`Error connecting device: ${e}`, "red"));
    addToDebugLog(`Exception details: ${e}`);
  }
}

async function getInstalledApps() {
  try {
    const { stdout, stderr, exitCode } = await execCommand(
      `${adbPath} shell pm list packages`
    );
    if (exitCode === 0) {
      console.log(colorText("Installed Apps:", "blue"));
      console.log(stdout);
    } else {
      console.error(
        colorText(`Failed to get installed apps: ${stderr}`, "red")
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("device offline")) {
      console.error(
        colorText(
          "Device is offline. Please ensure it's connected and try again.",
          "yellow"
        )
      );
    } else {
      console.error(colorText(`Error getting installed apps: ${e}`, "red"));
    }
    addToDebugLog(`Exception details: ${e}`);
  }
}

async function getStorageInfo() {
  try {
    const { stdout, stderr, exitCode } = await execCommand(
      `${adbPath} shell df`
    );
    if (exitCode === 0) {
      console.log(colorText("Storage Info:", "blue"));
      console.log(stdout);
    } else {
      console.error(colorText(`Failed to get storage info: ${stderr}`, "red"));
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("device offline")) {
      console.error(
        colorText(
          "Device is offline. Please ensure it's connected and try again.",
          "yellow"
        )
      );
    } else {
      console.error(colorText(`Error getting storage info: ${e}`, "red"));
    }
    addToDebugLog(`Exception details: ${e}`);
  }
}

async function main() {
  console.log(colorText("WearOS Connector", "cyan"));

  adbPath = await findAdbPath();
  if (!adbPath) {
    console.error(
      colorText(
        "ADB not found. Please install it and add it to your PATH.",
        "red"
      )
    );
    process.exit(1);
  }
  console.log(colorText(`ADB found at: ${adbPath}`, "green"));

  const isConnected = await isDeviceConnected();
  if (isConnected) {
    console.log(colorText("A device is already connected.", "green"));
    await getInstalledApps();
    await getStorageInfo();
  } else {
    console.log(colorText("No device connected. Let's connect one.", "yellow"));
    const ipAddress = await question("Enter IP Address: ");
    const port = await question("Enter Port: ");
    const pairCode = await question("Enter Pair Code: ");

    await pairDevice(ipAddress, port, pairCode);
    await connectDevice(ipAddress, port);
  }

  console.log(colorText("\nDebug Log:", "magenta"));
  console.log(debugLog);

  console.log(
    colorText(
      "\nFull debug log has been saved to wearos_connector_debug.log",
      "yellow"
    )
  );

  rl.close();
}

main();
