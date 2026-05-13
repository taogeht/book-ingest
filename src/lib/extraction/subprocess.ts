import { spawn } from 'node:child_process';

export type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

// Thin spawn() wrapper that collects stdout/stderr and resolves on close.
// Marker emits ML model progress on stderr — we keep it (truncated) so the
// `parse_error` field stays useful on failure.
export async function runProcess(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const stdoutBuf: Buffer[] = [];
    const stderrBuf: Buffer[] = [];
    child.stdout.on('data', (d) => stdoutBuf.push(d));
    child.stderr.on('data', (d) => stderrBuf.push(d));

    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, opts.timeoutMs);
    }

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      stdout = Buffer.concat(stdoutBuf).toString('utf8');
      stderr = Buffer.concat(stderrBuf).toString('utf8');
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}
