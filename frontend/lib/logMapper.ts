export function mapDiscoverLog(line: string): string | null {
  // Example: INFO     discovery_agent.pipeline — Discovery pipeline starting — 2 file(s)
  const msg = line.replace(/^[A-Z]+\s+\S+\s+—\s+/, "").trim();

  if (/Discovery pipeline starting — (\d+) file\(s\)/i.test(msg)) {
    const match = msg.match(/Discovery pipeline starting — (\d+) file\(s\)/i);
    return `Aivar is starting the discovery pipeline for ${match?.[1]} file(s)...`;
  }
  if (/Ingesting \[([^\]]+)\] (.+)/i.test(msg)) {
    const match = msg.match(/Ingesting \[([^\]]+)\] (.+)/i);
    return `Ingesting ${match?.[2]} (${match?.[1]} format)...`;
  }
  if (/^\s*→\s*(\d+) chunk\(s\)/i.test(msg)) {
    const match = msg.match(/^\s*→\s*(\d+) chunk\(s\)/i);
    return `  - Parsed ${match?.[1]} text chunk(s)`;
  }
  if (/Total chunks after size enforcement: (\d+)/i.test(msg)) {
    return `Validated and optimized text chunks for extraction...`;
  }
  if (/Chunk (.+): (\d+) system\(s\) found/i.test(msg)) {
    const match = msg.match(/Chunk (.+): (\d+) system\(s\) found/i);
    return `  - Extracted ${match?.[2]} potential system(s) from chunk ${match?.[1]}`;
  }
  if (/Raw mentions across all chunks: (\d+)/i.test(msg)) {
    const match = msg.match(/Raw mentions across all chunks: (\d+)/i);
    return `Identified ${match?.[1]} total system mentions across files.`;
  }
  if (/Unique systems after deduplication: (\d+)/i.test(msg)) {
    const match = msg.match(/Unique systems after deduplication: (\d+)/i);
    return `Deduplicated systems (found ${match?.[1]} unique system(s)).`;
  }
  if (/Systems flagged for human review: (\d+)/i.test(msg)) {
    const match = msg.match(/Systems flagged for human review: (\d+)/i);
    return `Flagged ${match?.[1]} system(s) requiring human validation.`;
  }
  if (/Relationships found: (\d+)/i.test(msg)) {
    const match = msg.match(/Relationships found: (\d+)/i);
    return `Identified ${match?.[1]} integration relationship(s) between systems.`;
  }
  if (/Graph built — (\d+) node\(s\), (\d+) edge\(s\)/i.test(msg)) {
    const match = msg.match(/Graph built — (\d+) node\(s\), (\d+) edge\(s\)/i);
    return `Constructed knowledge graph with ${match?.[1]} systems and ${match?.[2]} integrations.`;
  }
  if (/Inventory written to: (.+)/i.test(msg)) {
    return `Saved discovered system inventory.`;
  }
  return null;
}

export function mapAnalyzeLog(line: string): string | null {
  const msg = line.replace(/^[A-Z]+\s+\S+\s+—\s+/, "").trim();

  if (/Level 2 pipeline starting — (\d+) use case\(s\)/i.test(msg)) {
    const match = msg.match(/Level 2 pipeline starting — (\d+) use case\(s\)/i);
    return `Aivar is initiating Level 2 gap analysis for ${match?.[1]} use case(s)...`;
  }
  if (/Inventory contains (\d+) system\(s\)/i.test(msg)) {
    const match = msg.match(/Inventory contains (\d+) system\(s\)/i);
    return `Loaded ${match?.[1]} system(s) from inventory.`;
  }
  if (/Analysing use case (\d+)\/(\d+):\s*(.+)/i.test(msg)) {
    const match = msg.match(/Analysing use case (\d+)\/(\d+):\s*(.+)/i);
    return `Analyzing use case ${match?.[1]} of ${match?.[2]}: "${match?.[3]}"`;
  }
  if (/Dependency mapping complete: (\d+) mappings/i.test(msg)) {
    const match = msg.match(/Dependency mapping complete: (\d+) mappings/i);
    return `Mapped ${match?.[1]} system dependencies for use cases.`;
  }
  if (/Gap analysis: (\d+) use case\(s\) not covered by inventory/i.test(msg)) {
    const match = msg.match(/Gap analysis: (\d+) use case\(s\) not covered by inventory/i);
    return `Identified ${match?.[1]} unmapped gap(s) not covered by existing systems.`;
  }
  if (/Effort classification complete/i.test(msg)) {
    return `Completed implementation effort classification.`;
  }
  if (/Priority scoring complete/i.test(msg)) {
    return `Completed priority scoring for gap resolutions.`;
  }
  if (/Dependency graph — (\d+) integration\(s\) blocking use cases/i.test(msg)) {
    const match = msg.match(/Dependency graph — (\d+) integration\(s\) blocking use cases/i);
    return `Mapped ${match?.[1]} system integration blockers.`;
  }
  return null;
}

export function mapGenerateLog(line: string): string | null {
  const msg = line.replace(/^[A-Z]+\s+\S+\s+—\s+/, "").trim();

  if (/Level 3 pipeline — (\d+) missing gap\(s\) to generate for/i.test(msg)) {
    const match = msg.match(/Level 3 pipeline — (\d+) missing gap\(s\) to generate for/i);
    return `Aivar is starting Level 3 connector code generation for ${match?.[1]} missing gap(s)...`;
  }
  if (/\[(\d+)\/(\d+)\] Generating bundle for (.+)/i.test(msg)) {
    const match = msg.match(/\[(\d+)\/(\d+)\] Generating bundle for (.+)/i);
    return `Generating integration connector code for ${match?.[3]} (${match?.[1]} of ${match?.[2]})...`;
  }
  if (/Step 1\/4: Extracting ConnectorSpec/i.test(msg)) {
    return `  - Extracting connector specifications...`;
  }
  if (/Step 2\/4: Extracting AgentDefSpec/i.test(msg)) {
    return `  - Designing agent configuration schemas...`;
  }
  if (/Step 3\/4: Rendering templates/i.test(msg)) {
    return `  - Rendering code and README templates...`;
  }
  if (/Files written to (.+)/i.test(msg)) {
    return `  - Code files written to output directory.`;
  }
  if (/Step 4\/4: Running validation gate/i.test(msg)) {
    return `  - Running automated validation checks and tests...`;
  }
  if (/Validation: (.+)/i.test(msg)) {
    const match = msg.match(/Validation: (.+)/i);
    return `  - Code validation gate: ${match?.[1]}`;
  }
  return null;
}
