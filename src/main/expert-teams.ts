import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IpcExpertRole, IpcExpertTeam, IpcSkillSummary } from "../shared/ipc-types";

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SKILL_BYTES = 64 * 1024;
const MAX_ROLES = 12;
const MAX_TASK_CHARS = 32_000;
const MAX_PROMPT_CHARS = 96 * 1024;
const MAX_INSTRUCTIONS_CHARS = 16 * 1024;

interface TeamManifest {
	schemaVersion?: number;
	id?: string;
	name?: string;
	description?: string;
	category?: string;
	roles?: Array<{
		id?: string;
		name?: string;
		role?: string;
		description?: string;
		instructions?: string;
		skills?: string[];
	}>;
}

function boundedText(value: unknown, max: number): string {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeId(value: unknown): string | null {
	return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value) ? value : null;
}

export async function listExpertTeams(): Promise<{ teams: IpcExpertTeam[]; skills: IpcSkillSummary[] }> {
	const home = os.homedir();
	const teamsRoot = path.join(home, ".agents", "teams");
	const skillsRoot = path.join(home, ".agents", "skills");
	const teams: IpcExpertTeam[] = [];
	const skills: IpcSkillSummary[] = [];

	try {
		const entries = await fs.readdir(teamsRoot, { withFileTypes: true });
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (!entry.isDirectory()) continue;
			const dir = path.resolve(teamsRoot, entry.name);
			const file = path.join(dir, "team.json");
			try {
				const realTeamsRoot = await fs.realpath(teamsRoot);
				const realFile = await fs.realpath(file);
				if (!realFile.startsWith(`${realTeamsRoot}${path.sep}`)) continue;
				const stat = await fs.stat(realFile);
				if (stat.size > MAX_MANIFEST_BYTES) continue;
				const manifest = JSON.parse(await fs.readFile(realFile, "utf8")) as TeamManifest;
				const id = safeId(manifest.id) ?? safeId(entry.name);
				if (
					!id ||
					!Array.isArray(manifest.roles) ||
					manifest.roles.length === 0 ||
					manifest.roles.length > MAX_ROLES
				)
					continue;
				const roles: IpcExpertRole[] = manifest.roles.flatMap((role, index) => {
					const roleId = safeId(role.id) ?? `role-${index + 1}`;
					const name = boundedText(role.name ?? role.role, 100);
					if (!name) return [];
					return [
						{
							id: roleId,
							name,
							description: boundedText(role.description ?? role.instructions, 500),
							instructions: boundedText(role.instructions ?? role.description, MAX_INSTRUCTIONS_CHARS),
							skills: Array.isArray(role.skills)
								? role.skills
										.filter((skill): skill is string => typeof skill === "string")
										.map(skill => skill.slice(0, 100))
										.slice(0, 20)
								: [],
						},
					];
				});
				if (roles.length !== manifest.roles.length) continue;
				teams.push({
					id,
					name: boundedText(manifest.name, 120) || id,
					description: boundedText(manifest.description, 1000),
					category: boundedText(manifest.category, 100) || "General",
					roles,
					path: dir,
				});
			} catch {
				// Ignore malformed or unreadable user manifests and keep catalog usable.
			}
		}
	} catch {
		// Missing team folder is a normal empty catalog state.
	}

	try {
		const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (!entry.isDirectory() || !safeId(entry.name)) continue;
			const file = path.join(skillsRoot, entry.name, "SKILL.md");
			try {
				const realSkillsRoot = await fs.realpath(skillsRoot);
				const realFile = await fs.realpath(file);
				if (!realFile.startsWith(`${realSkillsRoot}${path.sep}`)) continue;
				const stat = await fs.stat(realFile);
				if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) continue;
				const body = await fs.readFile(realFile, { encoding: "utf8", flag: "r" });
				const frontmatter = /^---\s*\n([\s\S]*?)\n---/.exec(body)?.[1] ?? "";
				const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.replace(/^['"]|['"]$/g, "") ?? "";
				skills.push({ name: entry.name, description: boundedText(description, 500), path: realFile });
			} catch {
				// Broken individual skill files do not hide other installed skills.
			}
		}
	} catch {
		// Missing shared skill folder is a normal empty catalog state.
	}
	return { teams, skills };
}

export async function buildExpertRolePrompts(team: IpcExpertTeam, task: string): Promise<string[]> {
	if (task.trim().length === 0 || task.length > MAX_TASK_CHARS)
		throw new Error(`Task must contain 1–${MAX_TASK_CHARS} characters`);
	const root = path.join(os.homedir(), ".agents", "skills");
	const roleSections: string[] = [];
	for (const role of team.roles) {
		const skillSections: string[] = [];
		for (const skill of role.skills) {
			if (!safeId(skill)) continue;
			const file = path.join(root, skill, "SKILL.md");
			try {
				const realRoot = await fs.realpath(root);
				const resolved = await fs.realpath(file);
				if (!resolved.startsWith(`${realRoot}${path.sep}`)) continue;
				const stat = await fs.stat(resolved);
				if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) continue;
				skillSections.push(`### Skill: ${skill}\n${await fs.readFile(resolved, { encoding: "utf8", flag: "r" })}`);
			} catch {
				// Missing optional skills are reported by name in the team prompt.
			}
		}
		const prompt = [
			`You are the ${role.name} expert in the ${team.name}.`,
			role.instructions,
			role.skills.length ? `Apply these skill instructions when present: ${role.skills.join(", ")}.` : "",
			skillSections.join("\n\n"),
			`User task:\n${task.trim()}`,
			"Return your findings and concrete output for the next expert. State uncertainty. Do not claim to be a separate model or agent.",
		]
			.filter(Boolean)
			.join("\n\n");
		if (prompt.length > MAX_PROMPT_CHARS)
			throw new Error(`Instructions for ${role.name} exceed the 96 KiB prompt limit`);
		roleSections.push(prompt);
	}
	return roleSections;
}
