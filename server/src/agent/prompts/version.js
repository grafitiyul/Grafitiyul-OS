// The prompt identity, recorded on every AgentRun.
//
// Prompts are application configuration, not hidden magic strings. When the
// system constraints, the section renderers or the task instruction change in a
// way that could change output quality, BUMP THIS — otherwise a quality
// regression six weeks from now is unattributable.
//
// Format: v<major>.<minor>. Major = the contract with the model changed
// (sections added/removed, output schema changed). Minor = wording.
export const PROMPT_VERSION = 'v1.0';
