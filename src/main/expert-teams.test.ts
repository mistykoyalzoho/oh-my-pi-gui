import { describe, expect, it } from "vitest";
import type { IpcExpertTeam } from "../shared/ipc-types";
import { buildExpertRolePrompts } from "./expert-teams";

const team: IpcExpertTeam = {
	id: "research",
	name: "Research Team",
	description: "A small expert team",
	category: "Research",
	path: "/unused",
	roles: [
		{
			id: "analyst",
			name: "Analyst",
			description: "Checks the evidence",
			instructions: "Use primary sources and preserve uncertainty.",
			skills: [],
		},
	],
};

describe("expert team prompts", () => {
	it("keeps the full role instructions and task in its own sequential turn", async () => {
		const [prompt] = await buildExpertRolePrompts(team, "Compare the two approaches");
		expect(prompt).toContain("Use primary sources and preserve uncertainty.");
		expect(prompt).toContain("Compare the two approaches");
		expect(prompt).toContain("Return your findings and concrete output for the next expert");
	});

	it("rejects empty or oversized tasks before building prompts", async () => {
		await expect(buildExpertRolePrompts(team, "   ")).rejects.toThrow("Task must contain");
		await expect(buildExpertRolePrompts(team, "x".repeat(32_001))).rejects.toThrow("Task must contain");
	});
});
