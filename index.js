#!/usr/bin/env node
const { spawn, execSync } = require("child_process")
const path = require("path")
const net = require("net")
const shell = require("shelljs")
const inquirer = require("inquirer")
const chalk = require("chalk")
const program = require("commander")

program
  .option("-d, --default", "Auto select first created emulator")
  .option("-w, --writable", "Enable -writable-system")
  .option("-n, --nosnapshot", "Enable -no-snapshot-load")

program.parse(process.argv)

const APP_NAME = "react-native-run-android"
const RN_URI =
  "https://facebook.github.io/react-native/docs/getting-started.html"
const REQUIRED_BINS = ["react-native", "emulator", "adb"]

const whichEmulator = shell.which("emulator")

const showDepFailureMessgae = () =>
  console.error(
    `${chalk.red(`Please refer to `) +
      chalk.blue(`${RN_URI}`)} for installation/setup instructions`
  )

const requireBin = bin => {
  if (!shell.which(bin)) {
    console.error(chalk.red(`${APP_NAME} requires ${bin}.`))
    showDepFailureMessgae()
    process.exit(1)
  }
}

const getDevices = () =>
  shell
    .exec(`emulator -list-avds`, { silent: true })
    .stdout.split(/\n/)
    .filter(s => s !== "")
    .map(s => s.trim())

const adbDeviceIsRunning = () =>
  /emulator-\d+\s+device/.test(execSync(`adb devices`).toString())

const adbDeviceIsBootCompleted = () =>
  // We don't want to output error here when checking BOOT_COMPLETED
  /BOOT_COMPLETED/.test(
    execSync(`adb shell am broadcast -a android.intent.action.BOOT_COMPLETED`, {
      stdio: "pipe"
    }).toString()
  )

const pollADBBootcompleted = (maxTime = 60000) =>
  new Promise((resolve, reject) => {
    console.log(chalk.blue("Checking boot completed..."))
    const timer = setInterval(() => {
      try {
        if (adbDeviceIsBootCompleted()) {
          clearInterval(timer)
          resolve()
        }
      } catch {}
    })
  })

const pollADBDevice = (maxTime = 60000) =>
  new Promise((resolve, reject) => {
    console.log(chalk.blue(`Checking device running...`))
    const start = Date.now()
    const timer = setInterval(() => {
      if (adbDeviceIsRunning()) {
        clearInterval(timer)
        resolve()
      }
      if (Date.now() - start >= maxTime) {
        clearInterval(timer)
        reject(new Error("No device running"))
      }
    })
  })

const emulateDevice = device => {
  console.log(chalk.blue(`Starting emulator for device ${device} ...`))
  let options = []
  if (program.nosnapshot) options.push("-no-snapshot-load")
  if (program.writable) options.push("-writable-system")

  spawn("emulator", [`@${device}`, ...options], {
    cwd: path.dirname(whichEmulator.stdout),
    stdio: ["pipe"],
    detached: true
  })

  return pollADBDevice()
    .then(() => {
      console.log(chalk.green(`Device is running!`))
    })
    .then(() => {
      execSync("adb root")
    })
    .then(pollADBBootcompleted)
    .then(() => {
      console.log(chalk.green(`Device is boot completed!`))
      return true
    })
}

const isPortTaken = port =>
  new Promise((resolve, reject) => {
    const tester = net
      .createServer()
      .once("error", err =>
        err.code == "EADDRINUSE" ? resolve(false) : reject(err)
      )
      .once("listening", () =>
        tester.once("close", () => resolve(true)).close()
      )
      .listen(port)
  })

const startReactNativePackager = () => {
  console.log(chalk.blue(`Starting react-native package server ...`))
  try {
    const portInUsed = isPortTaken(8081)
    if (portInUsed) {
      console.log(
        chalk.red(
          `Port 8081 in used! Seems like package manager is already running!`
        )
      )
      return Promise.resolve()
    }
  } catch {
    return Promise.resolve()
  }
  spawn("react-native", ["start"], {
    stdio: ["pipe", process.stdout, process.stderr]
  })
  return Promise.resolve()
}

const startReactNative = () => {
  console.log(chalk.blue(`Starting react-native ...`))
  const child = spawn("react-native", ["run-android"], {
    stdio: ["pipe", process.stdout, process.stderr]
  })
  child.on("close", function(code) {
    process.exit(0)
  })
}

const main = () => {
  REQUIRED_BINS.forEach(requireBin)
  if (adbDeviceIsRunning()) {
    console.log(chalk.green(`Device is already running! By pass all options.`))
    Promise.all([startReactNativePackager()]).then(() => startReactNative())
    return
  }

  const devices = getDevices()
  if (!devices || devices.length == 0) {
    console.error(chalk.red(`Please create a virtual device`))
    showDepFailureMessgae()
    process.exit(1)
  }

  if (program.writable) {
    console.log(chalk.green(`Wiretable mode is seleted`))
  }

  if (program.nosnapshot) {
    console.log(chalk.green(`NoSnapshot mode is seleted`))
  }

  if (program.default) {
    console.log(
      chalk.green(
        `Default option is seleted. First created emulator will be choosen.`
      )
    )
    return Promise.all([
      emulateDevice(devices[0]),
      startReactNativePackager()
    ]).then(() => startReactNative())
  }

  inquirer
    .prompt([
      {
        type: "list",
        name: "device",
        message: "Which device would you like to use?",
        choices: devices
      }
    ])
    .then(answer => {
      const { device } = answer

      return Promise.all([
        emulateDevice(device),
        startReactNativePackager()
      ]).then(() => startReactNative())
    })
    .catch(error => {
      console.error(chalk.red`Something failed:\n`, error)
    })
}

main()
