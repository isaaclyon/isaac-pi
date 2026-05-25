#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawn, execFileSync, execSync } from "node:child_process";
import os from "node:os";
import puppeteer from "puppeteer-core";

const useProfile = process.argv[2] === "--profile";

if (process.argv[2] && process.argv[2] !== "--profile") {
	console.log("Usage: browser-start.js [--profile]");
	console.log("\nOptions:");
	console.log("  --profile  Copy your default Chrome profile (cookies, logins)");
	process.exit(1);
}

const SCRAPING_DIR = `${process.env.HOME}/.cache/browser-tools`;

// Check if already running on :9222
try {
	const browser = await puppeteer.connect({
		browserURL: "http://localhost:9222",
		defaultViewport: null,
	});
	await browser.disconnect();
	console.log("✓ Chrome already running on :9222");
	process.exit(0);
} catch {}

// Setup profile directory
execSync(`mkdir -p "${SCRAPING_DIR}"`, { stdio: "ignore" });

// Remove SingletonLock to allow new instance
try {
	execSync(`rm -f "${SCRAPING_DIR}/SingletonLock" "${SCRAPING_DIR}/SingletonSocket" "${SCRAPING_DIR}/SingletonCookie"`, { stdio: "ignore" });
} catch {}

const platform = os.platform();
const chromePath = findChromePath();
const sourceProfileDir = defaultProfileDir(platform);

if (useProfile) {
	if (sourceProfileDir === undefined || !existsSync(sourceProfileDir)) {
		console.error(`✗ Could not find a default Chrome profile for ${platform}`);
		process.exit(1);
	}
	console.log(`Syncing profile from ${sourceProfileDir}...`);
	execFileSync(
		"rsync",
		[
			"-a",
			"--delete",
			"--exclude=SingletonLock",
			"--exclude=SingletonSocket",
			"--exclude=SingletonCookie",
			"--exclude=*/Sessions/*",
			"--exclude=*/Current Session",
			"--exclude=*/Current Tabs",
			"--exclude=*/Last Session",
			"--exclude=*/Last Tabs",
			`${sourceProfileDir}/`,
			`${SCRAPING_DIR}/`,
		],
		{ stdio: "pipe" },
	);
}

const args = [
	"--remote-debugging-port=9222",
	`--user-data-dir=${SCRAPING_DIR}`,
	"--no-first-run",
	"--no-default-browser-check",
];

if (platform === "linux") {
	args.push("--no-sandbox");
	if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
		args.push("--headless=new");
	}
}

const child = spawn(chromePath, args, { detached: true, stdio: "ignore" });
child.on("error", (error) => {
	console.error(`✗ Failed to start Chrome at ${chromePath}: ${error.message}`);
	process.exit(1);
});
child.unref();

// Wait for Chrome to be ready
let connected = false;
for (let i = 0; i < 30; i++) {
	try {
		const browser = await puppeteer.connect({
			browserURL: "http://localhost:9222",
			defaultViewport: null,
		});
		await browser.disconnect();
		connected = true;
		break;
	} catch {
		await new Promise((r) => setTimeout(r, 500));
	}
}

if (!connected) {
	console.error("✗ Failed to connect to Chrome");
	process.exit(1);
}

console.log(`✓ Chrome started on :9222 using ${chromePath}${useProfile ? " with your profile" : ""}`);

function findChromePath() {
	if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
		return process.env.CHROME_PATH;
	}

	const candidatesByPlatform = {
		darwin: [
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		],
		linux: [
			"/usr/bin/google-chrome",
			"/usr/bin/google-chrome-stable",
			"/usr/bin/chromium",
			"/usr/bin/chromium-browser",
		],
		win32: [
			`${process.env.PROGRAMFILES ?? "C:/Program Files"}/Google/Chrome/Application/chrome.exe`,
			`${process.env["PROGRAMFILES(X86)"] ?? "C:/Program Files (x86)"}/Google/Chrome/Application/chrome.exe`,
		],
	};

	for (const candidate of candidatesByPlatform[platform] ?? []) {
		if (existsSync(candidate)) return candidate;
	}

	for (const command of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
		try {
			return execFileSync("which", [command], { encoding: "utf8" }).trim();
		} catch {}
	}

	console.error("✗ Could not find Chrome/Chromium. Set CHROME_PATH to the browser executable.");
	process.exit(1);
}

function defaultProfileDir(currentPlatform) {
	if (currentPlatform === "darwin") {
		return `${process.env.HOME}/Library/Application Support/Google/Chrome`;
	}
	if (currentPlatform === "linux") {
		for (const candidate of [
			`${process.env.HOME}/.config/google-chrome`,
			`${process.env.HOME}/.config/chromium`,
		]) {
			if (existsSync(candidate)) return candidate;
		}
	}
	if (currentPlatform === "win32") {
		return `${process.env.LOCALAPPDATA}/Google/Chrome/User Data`;
	}
	return undefined;
}
