import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { type ElectronApplication, _electron as electron, type Page } from "playwright";

test.setTimeout(180_000);

let app: ElectronApplication;
let page: Page;
let profile: string;
let record: string;
const errors: string[] = [];

async function recorded(type: string) {
	const text = await fs.readFile(record, "utf8").catch(() => "");
	return text
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line))
		.filter(command => command.type === type);
}

test.beforeAll(async () => {
	profile = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-audit-"));
	const project = path.join(profile, "project");
	const userData = path.join(profile, "desktop");
	const agent = path.join(profile, "agent");
	await Promise.all([fs.mkdir(project), fs.mkdir(userData), fs.mkdir(agent)]);
	record = path.join(profile, "rpc.jsonl");
	await fs.writeFile(path.join(userData, "prefs.json"), JSON.stringify({ language: "en", firstRunComplete: true }));
	const fixture = path.resolve("e2e/sidecar-fixture.ts");
	await fs.chmod(fixture, 0o755);
	const env = {
		...process.env,
		PI_CODING_AGENT_DIR: agent,
		PI_CONFIG_DIR: path.relative(os.homedir(), profile),
		OMP_PROFILE: "",
		PI_PROFILE: "",
		OMP_BUNDLED_OMP: fixture,
		OMP_GUI_TEST_RECORD: record,
		OMP_GUI_TEST_STATS_BINARY: path.resolve("resources/omp"),
	};
	Reflect.deleteProperty(env, "ELECTRON_RUN_AS_NODE");
	app = await electron.launch({
		args: [path.resolve("out/main/index.js"), project, `--user-data-dir=${userData}`, "--disable-gpu"],
		env,
	});
	page = await app.firstWindow();
	page.on("pageerror", error => errors.push(error.message));
	await page.waitForFunction(() => window.omp?.rpc != null && document.body.innerText.length > 0);
	await expect.poll(async () => (await page.evaluate(() => window.omp.sidecar.getStatus())).status).toBe("ready");
});

test.afterAll(async () => {
	// Test teardown bypasses the production quit confirmation.
	if (app) await app.evaluate(({ app }) => app.exit(0));
	if (record) await fs.copyFile(record, "test-results/expert-hub-rpc.jsonl").catch(() => {});
	if (profile) await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("expert teams run separate turns and restore results after reopening", async () => {
	await page.keyboard.press("Alt+a");
	let modal = page.getByRole("dialog");
	await modal.getByRole("tab", { name: "Expert teams", exact: true }).click();
	await expect(modal.getByRole("button", { name: "Run team", exact: true })).toBeVisible();
	await expect(modal.getByRole("button", { name: "Connectors and MCP", exact: true })).toBeVisible();
	const catalog = await page.evaluate(() => window.omp.expertTeams.list());
	expect(catalog.teams.length).toBeGreaterThan(0);
	const promptsBefore = (await recorded("prompt")).length;
	await modal.locator("#expert-team-task").fill("Write a concise implementation review.");
	await modal.getByRole("button", { name: "Run team", exact: true }).click();
	await expect(modal.getByRole("status")).toHaveText("Completed", { timeout: 30000 });
	await expect(modal).toContainText("Local fixture reply");
	expect(await recorded("prompt")).toHaveLength(promptsBefore + catalog.teams[0].roles.length + 1);
	const completed = await page.evaluate(() => window.omp.expertTeams.list());
	expect(completed.latestRun?.status).toBe("completed");
	const artifact = completed.latestRun?.artifactPath;
	expect(artifact).toBeTruthy();
	expect((await fs.stat(artifact!)).mode & 0o777).toBe(0o600);
	await page.screenshot({ path: "test-results/expert-hub-completed.png", scale: "css", animations: "disabled" });
	await page.keyboard.press("Escape");
	await page.keyboard.press("Alt+a");
	modal = page.getByRole("dialog");
	await modal.getByRole("tab", { name: "Expert teams", exact: true }).click();
	await expect(modal.getByRole("status")).toHaveText("Completed");
	await expect(modal).toContainText("Local fixture reply");
	expect(errors).toEqual([]);
});
