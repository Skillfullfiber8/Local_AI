import { exec } from "child_process";

function runCommand(command) {
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        return resolve(`Error: ${error.message}`);
      }
      resolve(stdout || "Done");
    });
  });
}

export async function actionTool(action, input) {
  switch (action) {

    case "open_app": {
      const apps = {
        chrome: "start chrome",
        brave: "start brave",
        vscode: "code",
        notepad: "notepad",
        explorer: "explorer"
      };

      const key = input.toLowerCase();

      // 1. try known apps
      if (apps[key]) {
        await runCommand(apps[key]);
        return `${key} opened`;
      }

      // 2. fallback → try directly
      await runCommand(`start ${key}`);
      return `${key} opened`;
    }

    case "open_url": {
      const url = input.startsWith("http") ? input : `https://${input}`;
        
      const bravePath = `"C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"`;
        
      await runCommand(`start "" ${bravePath} ${url}`);
        
      return `Opened ${url} in Brave`;
    }

    case "google_search": {
      const query = encodeURIComponent(input);
      const url = `https://www.google.com/search?q=${query}`;
      await runCommand(`start ${url}`);
      return `Searching Google for ${input}`;
    }

    default:
      return "Unknown action";
  }
}