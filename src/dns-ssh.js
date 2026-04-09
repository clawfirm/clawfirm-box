import { spawn } from 'node:child_process';

function normalizeMode(config) {
  const mode = typeof config?.dnsMode === 'string' ? config.dnsMode.trim().toLowerCase() : 'ssh';
  return mode === 'local' ? 'local' : 'ssh';
}

async function defaultRunner(command, args, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || `Command failed with exit code ${code}`));
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function sshArgs(config, remoteCommand) {
  const args = [
    '-p',
    String(config.dnsSshPort || 22),
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
  ];

  if (config.dnsSshKeyPath) {
    args.push('-i', config.dnsSshKeyPath);
  }

  args.push(`${config.dnsSshUser}@${config.dnsSshHost}`, remoteCommand);
  return args;
}

function localArgs(localCommand) {
  return ['-lc', localCommand];
}

function validateExecutorConfig(config, mode) {
  if (mode === 'local') {
    return;
  }

  if (!config.dnsSshHost || !config.dnsSshUser) {
    throw new Error('DNS SSH host/user are not configured');
  }
}

export function createDnsExecutor(config, runner = defaultRunner) {
  return async function execute(remoteCommand, payload) {
    const mode = normalizeMode(config);
    validateExecutorConfig(config, mode);
    const { command, args } = mode === 'local'
      ? { command: 'bash', args: localArgs(remoteCommand) }
      : { command: 'ssh', args: sshArgs(config, remoteCommand) };
    const { stdout, stderr } = await runner(command, args, payload);
    const text = stdout?.trim();

    if (!text) {
      throw new Error(stderr?.trim() || 'DNS command returned no output');
    }

    const parsed = JSON.parse(text);
    if (parsed?.ok === false) {
      throw new Error(parsed.error || 'DNS command failed');
    }

    return parsed;
  };
}
