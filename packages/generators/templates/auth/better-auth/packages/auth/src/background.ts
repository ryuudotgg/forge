type BackgroundRunner = (task: Promise<unknown>) => void;

// A long running server finishes a dropped task, a serverless host must register a runner that outlives the response.
let runner: BackgroundRunner = () => {};
export function runBackgroundTasksWith(next: BackgroundRunner) {
  runner = next;
}

export function runInBackground(task: Promise<unknown>) {
  runner(task);
}
