import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IpcExpertTeamEvent } from "../../../shared/ipc-types";
import { I18nProvider } from "../../lib/i18n";

const { document, window, Event, HTMLElement, Node } = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { document, window, Event, HTMLElement, Node, IS_REACT_ACT_ENVIRONMENT: true });
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(callback, 0);
const { createRoot } = await import("react-dom/client");
const { ExpertTeamsTab } = await import("./ExpertTeamsTab");

let container: HTMLElement;
let root: Root;
let notify: ((event: IpcExpertTeamEvent) => void) | undefined;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

async function mount(element: ReactElement): Promise<void> {
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => root.render(<I18nProvider>{element}</I18nProvider>));
	await flush();
}

afterEach(async () => {
	if (root) await act(async () => root.unmount());
	container?.remove();
	vi.restoreAllMocks();
});

describe("ExpertTeamsTab", () => {
	it("loads shared teams and reattaches to a run across panel remounts", async () => {
		const catalog = {
			teams: [
				{
					id: "research",
					name: "Research team",
					description: "Investigate a question",
					category: "research",
					path: "/team.json",
					roles: [{ id: "scout", name: "Scout", description: "Find evidence", skills: ["web"] }],
				},
			],
			skills: [{ name: "web", description: "Search sources", path: "/SKILL.md" }],
			marketplaces: [
				{
					name: "Skillshare",
					url: "https://example.test",
					kind: "skills" as const,
					compatibility: "external-catalog" as const,
				},
			],
			latestRun: { runId: "r1", teamId: "research", status: "started" as const, currentRole: "Scout" },
		};
		const list = vi.fn(async () => catalog);
		const cancel = vi.fn(async () => ({ cancelled: true }));
		(window as unknown as { omp: { expertTeams: unknown } }).omp = {
			expertTeams: {
				list,
				run: vi.fn(),
				cancel,
				onEvent: vi.fn((callback: (event: IpcExpertTeamEvent) => void) => {
					notify = callback;
					return () => {
						notify = undefined;
					};
				}),
			},
		};

		await mount(<ExpertTeamsTab />);
		expect(document.body.textContent).toContain("Research team");
		expect(document.body.textContent).toContain("Skills (1)");
		expect(document.body.textContent).toContain("Running: Scout");
		const cancelButton = Array.from(document.querySelectorAll("button")).find(
			button => button.textContent === "Cancel run",
		);
		if (!cancelButton) throw new Error("cancel button missing");
		await act(async () => cancelButton.dispatchEvent(new Event("click", { bubbles: true })));
		expect(cancel).toHaveBeenCalledWith("r1");
		await act(async () =>
			notify?.({
				runId: "r1",
				teamId: "research",
				status: "completed",
				result: "<script>unsafe()</script>\n\n**Complete**",
			}),
		);
		expect(document.body.textContent).toContain("Complete");
		expect(document.querySelector("script")).toBeNull();
	});
});
