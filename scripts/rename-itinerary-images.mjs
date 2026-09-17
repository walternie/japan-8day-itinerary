import { access, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { imageCredits } from "../data/image-credits.js";
import { days } from "../data/itinerary.js";
import { getStepImageFilename } from "../lib/site.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const imageDirectory = resolve(root, "assets", "images");
const creditsPath = resolve(root, "data", "image-credits.js");
const steps = days.flatMap((day) => day.steps);

const filenames = steps.map(getStepImageFilename);
if (new Set(filenames).size !== filenames.length) {
  const duplicates = filenames.filter(
    (filename, index) => filenames.indexOf(filename) !== index,
  );
  throw new Error(`Duplicate itinerary filenames: ${[...new Set(duplicates)].join(", ")}`);
}

for (const step of steps) {
  const oldPath = resolve(imageDirectory, `${step.id}.jpg`);
  const newPath = resolve(imageDirectory, getStepImageFilename(step));
  try {
    await access(newPath);
    continue;
  } catch {
    await rename(oldPath, newPath);
  }
}

const stepById = new Map(steps.map((step) => [step.id, step]));
const updatedCredits = imageCredits.map((credit) => {
  const step = stepById.get(credit.stepId);
  if (!step) throw new Error(`Unknown credit step: ${credit.stepId}`);
  return {
    ...credit,
    localFile: `assets/images/${getStepImageFilename(step)}`,
  };
});

const source =
  "// Generated from Flickr Creative Commons metadata returned by LoremFlickr.\n" +
  `export const imageCredits = ${JSON.stringify(updatedCredits, null, 2)};\n`;
await writeFile(creditsPath, source, "utf8");

console.log(`Renamed ${steps.length} images to D#-时间-行程名.jpg and updated credits.`);
