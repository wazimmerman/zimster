export function parseOptions(args) {
  const options = {};
  const positional = [];
  let passthrough = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--') {
      passthrough = args.slice(index + 1);
      break;
    }
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { options, positional, passthrough };
}

export function required(options, name) {
  const value = options[name];
  if (value === undefined || value === true || String(value).trim() === '') {
    throw new Error(`--${name} is required`);
  }
  return String(value);
}

export function integerOption(options, name, fallback = undefined) {
  if (options[name] === undefined) return fallback;
  const value = Number.parseInt(String(options[name]), 10);
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer`);
  return value;
}
