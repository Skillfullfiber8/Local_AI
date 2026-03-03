import fs from "fs";

import path from "path";

import * as chrono from "chrono-node";

const remindersFile = path.join(process.cwd(), "storage", "reminders.json");

let reminders = [];

/* ================= Load ================= */

export function loadReminders() {

  if (fs.existsSync(remindersFile)) {

    reminders = JSON.parse(fs.readFileSync(remindersFile));

  }

}

/* ================= Save ================= */

function saveReminders() {

  fs.writeFileSync(remindersFile, JSON.stringify(reminders, null, 2));

}

/* ================= Parse Natural Time ================= */

export function parseTime(text) {

  const results = chrono.parse(text);

  if (!results.length) return null;

  return results[0].start.date();

}

/* ================= Add Reminder ================= */

export function addReminder(user, task, time, recurrence = null) {

  const reminder = {

    id: Date.now(),

    user,

    task,

    time: time.getTime(),

    recurrence,

    pending: false

  };

  reminders.push(reminder);

  saveReminders();

  return reminder;

}

/* ================= List ================= */

export function listReminders(user) {

  return reminders.filter(r => r.user === user);

}

/* ================= Delete ================= */

export function deleteReminder(id) {

  reminders = reminders.filter(r => r.id !== id);

  saveReminders();

}

/* ================= Scheduler ================= */

export function startScheduler(waClient) {

  setInterval(async () => {

    const now = Date.now();

    for (let reminder of reminders) {

      if (reminder.time <= now) {

        if (waClient.info) {

          await waClient.sendMessage(

            reminder.user,

            "Jarvis: Reminder — " + reminder.task

          );

        } else {

          reminder.pending = true;

        }

        // Handle recurrence

        if (reminder.recurrence === "daily") {

          reminder.time += 86400000;

        } else {

          reminder.time = null;

        }

      }

    }

    reminders = reminders.filter(r => r.time !== null);

    saveReminders();

  }, 5000);

}

/* ================= Flush Pending ================= */

export async function flushPending(waClient) {

  for (let reminder of reminders) {

    if (reminder.pending) {

      await waClient.sendMessage(

        reminder.user,

        "Jarvis: Reminder — " + reminder.task

      );

      reminder.pending = false;

    }

  }

  saveReminders();

}