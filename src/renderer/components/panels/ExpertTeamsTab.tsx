import { ExternalLink, Play, RefreshCw, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IpcExpertTeamEvent } from "../../../shared/ipc-types";
import { useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import { openLink } from "../../lib/open-link";
import { useUiStore } from "../../stores/ui";
import { Button, Spinner } from "../common";

type TeamCatalog = Awaited<ReturnType<Window["omp"]["expertTeams"]["list"]>>;
type Team = TeamCatalog["teams"][number];

export function ExpertTeamsTab() {
	const t = useT();
	const [catalog, setCatalog] = useState<TeamCatalog | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const [task, setTask] = useState("");
	const [status, setStatus] = useState<"idle" | "running" | "completed" | "cancelled" | "failed">("idle");
	const [currentRole, setCurrentRole] = useState<string | null>(null);
	const [result, setResult] = useState("");
	const [artifactPath, setArtifactPath] = useState<string | null>(null);
	const [runError, setRunError] = useState<string | null>(null);
	const runIdRef = useRef<string | null>(null);
	const startPendingRef = useRef(false);
	const pendingEventsRef = useRef<IpcExpertTeamEvent[]>([]);
	const team = useMemo(
		() => catalog?.teams.find(item => item.id === selected) ?? catalog?.teams[0] ?? null,
		[catalog, selected],
	);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const next = await window.omp.expertTeams.list();
			setCatalog(next);
			setSelected(current =>
				current && next.teams.some(item => item.id === current) ? current : (next.teams[0]?.id ?? null),
			);
			if (next.latestRun) {
				runIdRef.current = next.latestRun.runId;
				setSelected(next.latestRun.teamId);
				setCurrentRole(next.latestRun.currentRole ?? null);
				setResult(next.latestRun.result ?? "");
				setArtifactPath(next.latestRun.artifactPath ?? null);
				setRunError(next.latestRun.error ?? null);
				setStatus(next.latestRun.status === "started" ? "running" : next.latestRun.status);
			}
		} catch (cause) {
			setError(String(cause));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const applyEvent = useCallback((event: IpcExpertTeamEvent) => {
		if (event.runId !== runIdRef.current) return;
		if (event.currentRole) setCurrentRole(event.currentRole);
		if (event.result) setResult(event.result);
		if (event.artifactPath) setArtifactPath(event.artifactPath);
		if (event.error) setRunError(event.error);
		if (event.status !== "started") setStatus(event.status);
	}, []);

	useEffect(
		() =>
			window.omp.expertTeams.onEvent(event => {
				if (!runIdRef.current && startPendingRef.current) pendingEventsRef.current.push(event);
				else applyEvent(event);
			}),
		[applyEvent],
	);

	const start = async () => {
		if (!team || !task.trim() || status === "running") return;
		setRunError(null);
		setResult("");
		setArtifactPath(null);
		setCurrentRole(null);
		runIdRef.current = null;
		startPendingRef.current = true;
		pendingEventsRef.current = [];
		setStatus("running");
		try {
			const run = await window.omp.expertTeams.run({ teamId: team.id, task: task.trim() });
			startPendingRef.current = false;
			runIdRef.current = run.runId;
			for (const event of pendingEventsRef.current) applyEvent(event);
			pendingEventsRef.current = [];
		} catch (cause) {
			startPendingRef.current = false;
			pendingEventsRef.current = [];
			setStatus("failed");
			setRunError(String(cause));
		}
	};

	const cancel = async () => {
		const activeRunId = runIdRef.current;
		if (!activeRunId) return;
		try {
			await window.omp.expertTeams.cancel(activeRunId);
		} catch (cause) {
			setRunError(String(cause));
		}
	};

	const openSkills = () => useUiStore.getState().openSettings("skills");
	const openConnectors = () => useUiStore.getState().openSettings("mcp");
	const openMarketplaces = () => useUiStore.getState().openInventory("marketplaces");

	return (
		<div className="min-h-0 flex-1 overflow-y-auto p-4">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div className="text-omp-sm text-(--omp-muted)">{t("agentHub.teams.intro")}</div>
				<Button
					size="sm"
					variant="ghost"
					icon={<RefreshCw size={13} />}
					onClick={() => void refresh()}
					disabled={loading}
				>
					{t("agentHub.refresh")}
				</Button>
			</div>
			{loading && !catalog ? (
				<div className="flex justify-center py-8">
					<Spinner label={t("common.loading")} />
				</div>
			) : null}
			{error && (
				<div
					role="alert"
					className="mb-3 rounded-md bg-[var(--omp-tool-error-bg)] p-3 text-omp-sm text-[var(--omp-error)]"
				>
					{error}
				</div>
			)}
			{catalog && (
				<>
					<div className="mb-3 flex flex-wrap gap-2">
						<Button size="sm" variant="secondary" onClick={openSkills}>
							{t("agentHub.teams.skills", { count: catalog.skills.length })}
						</Button>
						<Button size="sm" variant="secondary" onClick={openConnectors}>
							{t("agentHub.teams.connectors")}
						</Button>
						<Button size="sm" variant="secondary" icon={<ExternalLink size={13} />} onClick={openMarketplaces}>
							{t("agentHub.teams.marketplaces")}
						</Button>
					</div>
					<div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.5fr)]">
						<div className="flex flex-col gap-2">
							{catalog.teams.map(item => (
								<TeamCard
									key={item.id}
									team={item}
									selected={item.id === team?.id}
									onSelect={() => setSelected(item.id)}
								/>
							))}
							{catalog.teams.length === 0 && (
								<div className="rounded-lg border border-dashed border-(--omp-border-muted) p-4 text-omp-sm text-(--omp-dim)">
									{t("agentHub.teams.empty")}
								</div>
							)}
						</div>
						<div className="min-w-0 rounded-lg border border-(--omp-border-muted) p-4">
							{team ? (
								<>
									<div className="mb-1 text-omp-lg font-semibold">{team.name}</div>
									{team.description && (
										<p className="mb-3 text-omp-sm text-(--omp-muted)">{team.description}</p>
									)}
									<div className="mb-3 flex flex-col gap-2">
										{team.roles.map(role => (
											<div key={role.id} className="rounded-md bg-(--omp-panel-bg) px-3 py-2">
												<div className="text-omp-sm font-medium">{role.name}</div>
												{role.description && (
													<div className="mt-0.5 text-omp-xs text-(--omp-dim)">{role.description}</div>
												)}
												{role.skills.length > 0 && (
													<div className="mt-1 text-omp-xs text-(--omp-muted)">
														{t("agentHub.teams.roleSkills", { skills: role.skills.join(", ") })}
													</div>
												)}
											</div>
										))}
									</div>
									<label className="mb-1 block text-omp-sm font-medium" htmlFor="expert-team-task">
										{t("agentHub.teams.task")}
									</label>
									<textarea
										id="expert-team-task"
										className="min-h-20 w-full resize-y rounded-md border border-(--omp-input-border) bg-(--omp-input-bg) p-2 text-omp-sm"
										value={task}
										onChange={event => setTask(event.currentTarget.value)}
										placeholder={t("agentHub.teams.taskPlaceholder")}
									/>
									<div className="mt-2 flex items-center gap-2">
										<Button
											size="sm"
											icon={<Play size={13} />}
											disabled={!task.trim() || status === "running"}
											onClick={() => void start()}
										>
											{t("agentHub.teams.run")}
										</Button>
										{status === "running" && (
											<Button
												size="sm"
												variant="secondary"
												icon={<Square size={12} />}
												onClick={() => void cancel()}
											>
												{t("agentHub.teams.cancel")}
											</Button>
										)}
										{status === "running" && (
											<span role="status" className="text-omp-xs text-(--omp-muted)">
												{t("agentHub.teams.running", {
													role: currentRole ?? t("agentHub.teams.preparing"),
												})}
											</span>
										)}
										{status !== "idle" && status !== "running" && (
											<span role="status" className="text-omp-xs text-(--omp-muted)">
												{t(`agentHub.teams.status.${status}`)}
											</span>
										)}
									</div>
									{runError && (
										<div role="alert" className="mt-3 text-omp-sm text-[var(--omp-error)]">
											{runError}
										</div>
									)}
									{result && (
										<section className="mt-4 border-t border-(--omp-border-muted) pt-3">
											<h3 className="mb-2 text-omp-sm font-semibold">{t("agentHub.teams.result")}</h3>
											<div className="max-h-80 overflow-auto text-omp-sm">
												<MarkdownRenderer content={result} />
											</div>
										</section>
									)}
									{artifactPath && (
										<div className="mt-2 break-all text-omp-xs text-(--omp-dim)">
											{t("agentHub.teams.artifact", { path: artifactPath })}
										</div>
									)}
								</>
							) : (
								<div className="text-omp-sm text-(--omp-dim)">{t("agentHub.teams.empty")}</div>
							)}
						</div>
					</div>
					{catalog.marketplaces.length > 0 && (
						<section className="mt-4 border-t border-(--omp-border-muted) pt-3">
							<h3 className="mb-2 text-omp-sm font-semibold">{t("agentHub.teams.marketplaceLinks")}</h3>
							<div className="flex flex-wrap gap-2">
								{catalog.marketplaces.map(source => (
									<button
										key={`${source.kind}:${source.name}`}
										type="button"
										onClick={() => openLink(source.url)}
										className="rounded-md border border-(--omp-border-muted) px-2.5 py-1.5 text-omp-xs hover:bg-(--omp-selected-bg)"
										title={t("agentHub.teams.externalCatalogHint")}
									>
										{source.name} · {t("agentHub.teams.externalCatalog")}
									</button>
								))}
							</div>
						</section>
					)}
				</>
			)}
		</div>
	);
}

function TeamCard({ team, selected, onSelect }: { team: Team; selected: boolean; onSelect: () => void }) {
	const t = useT();
	return (
		<button
			type="button"
			onClick={onSelect}
			aria-pressed={selected}
			className={`rounded-lg border p-3 text-left transition-colors ${selected ? "border-(--omp-accent) bg-(--omp-selected-bg)" : "border-(--omp-border-muted) hover:bg-(--omp-selected-bg)"}`}
		>
			<div className="text-omp-sm font-medium">{team.name}</div>
			<div className="mt-1 line-clamp-2 text-omp-xs text-(--omp-dim)">{team.description || team.category}</div>
			<div className="mt-2 text-omp-xs text-(--omp-muted)">
				{t("agentHub.teams.roleCount", { count: team.roles.length })}
			</div>
		</button>
	);
}
