const command = process.argv[2];

if (!command) {
  throw new Error("A research command name is required.");
}

throw new Error(`${command} is declared for the research workspace but is not implemented by the current Burnlist item.`);
