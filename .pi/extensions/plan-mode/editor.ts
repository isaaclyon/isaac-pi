import { CustomEditor, type KeybindingsManager } from "@mariozechner/pi-coding-agent";
import type { EditorTheme, TUI } from "@mariozechner/pi-tui";

export class PlanModeEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly planBorderColor: (text: string) => string,
	) {
		super(tui, theme, keybindings);
		this.borderColor = planBorderColor;
	}

	override render(width: number): string[] {
		this.borderColor = this.planBorderColor;
		return super.render(width);
	}
}
