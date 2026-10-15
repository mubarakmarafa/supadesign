export function buildFeedbackPrompt(input: {
  readonly serverVersion: string;
  readonly client: string;
}): string {
  const { serverVersion } = input;
  return `I want to send feedback about Supaterm from the ${input.client}.

Run \`supaterm triage --print\` and follow what it prints. If \`supaterm\` is not on PATH or reports a version other than ${serverVersion}, run \`npx supaterm@${serverVersion} triage --print\` instead.`;
}
