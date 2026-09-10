import { ItemView } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type TeamSyncPlugin from "../plugin";
import {
	buildTeamRows,
	OVERDUE_THRESHOLD_DAYS,
	todayISO,
	type TeamRow,
} from "./team-dashboard-model";

export const VIEW_TYPE_TEAM_DASHBOARD = "teamsync-team-dashboard";

/**
 * Team dashboard (PRD §5.5, Phase 1) — a thin renderer. All rollup logic
 * lives in team-dashboard-model.ts; this class only turns rows into DOM.
 * It performs no vault I/O itself: data comes from the metadata cache via
 * the model's walker, and rows open notes through the workspace.
 */
export class TeamDashboardView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: TeamSyncPlugin,
	) {
		super(leaf);
	}

	override getViewType(): string {
		return VIEW_TYPE_TEAM_DASHBOARD;
	}

	override getDisplayText(): string {
		return "TeamSync dashboard";
	}

	override getIcon(): string {
		return "users";
	}

	override async onOpen(): Promise<void> {
		// Re-read the cache on every event — frontmatter is never snapshotted
		// in view state (the staleness gotcha in patterns/add-command-or-view.md).
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => this.renderDashboard()),
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", () => this.renderDashboard()),
		);
		this.renderDashboard();
	}

	override async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private renderDashboard(): void {
		const root = this.contentEl;
		root.empty();

		let rows: TeamRow[];
		try {
			// Passes the vault/cache as references; the model does the reading.
			rows = buildTeamRows(
				this.app.vault,
				this.app.metadataCache,
				todayISO(),
				this.plugin.settings.devPlanReviewDays,
			);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			root.createEl("p", {
				text: `TeamSync: could not build the dashboard — ${detail}`,
				cls: "teamsync-dashboard-error",
			});
			return;
		}

		if (rows.length === 0) {
			root.createEl("p", {
				text: "No active team members yet — add one with the command \"TeamSync: Add team member\".",
			});
			return;
		}

		const table = root.createEl("table", { cls: "teamsync-dashboard" });
		const head = table.createEl("thead").createEl("tr");
		for (const label of [
			"Team member",
			"Last 1:1",
			"Days since",
			"Open goals",
			"Open action items",
			"Dev plan",
		]) {
			head.createEl("th", { text: label });
		}

		const body = table.createEl("tbody");
		for (const row of rows) {
			const tr = body.createEl("tr");
			tr.title = `Open ${row.name}'s profile`;
			// Workspace-based open — no vault.* in the view.
			tr.addEventListener("click", () => {
				void this.app.workspace.openLinkText(row.indexPath, "", false);
			});

			tr.createEl("td", { text: row.name, cls: "teamsync-dashboard-name" });

			const lastCell = tr.createEl("td");
			lastCell.setText(row.lastOneOnOneDate ?? "—");
			// Passive overdue badge only — notifications are an open PRD question.
			if (row.overdue) {
				lastCell.createEl("span", {
					text: `no 1:1 in ${OVERDUE_THRESHOLD_DAYS}+ days`,
					cls: "teamsync-dashboard-badge",
				});
			}

			tr.createEl("td", {
				text: row.daysSinceLastOneOnOne === null
					? "—"
					: String(row.daysSinceLastOneOnOne),
			});
			tr.createEl("td", {
				text: row.openGoals === 0 ? "—" : String(row.openGoals),
			});
			tr.createEl("td", {
				text: row.openActionItems === 0 ? "—" : String(row.openActionItems),
			});

			const devPlanCell = tr.createEl("td");
			if (row.devPlanState === "no-plan") {
				devPlanCell.setText("—");
			} else {
				devPlanCell.setText(row.devPlanLastReviewed ?? "—");
				// Passive stale badge only — notifications are an open PRD question.
				if (row.devPlanState === "stale") {
					devPlanCell.createEl("span", {
						text:
							row.devPlanLastReviewed === null
								? "never reviewed"
								: `not reviewed in ${this.plugin.settings.devPlanReviewDays}+ days`,
						cls: "teamsync-dashboard-badge",
					});
				}
			}
		}
	}
}
