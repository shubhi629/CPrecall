import fs from "fs";
import path from "path";
import https from "https";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_ROOT = path.resolve(__dirname, "..");
const BIN_DIR = path.join(SERVER_ROOT, "bin", "dynamodb");
const DATA_DIR = path.join(SERVER_ROOT, "dynamo-data");
const TAR_URL = "https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.tar.gz";
const TAR_PATH = path.join(BIN_DIR, "dynamodb_local_latest.tar.gz");

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        }
        if (response.statusCode !== 200) {
          return reject(new Error(`Download failed with status: ${response.statusCode}`));
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close(() => resolve());
        });
      })
      .on("error", (err) => {
        fs.unlink(dest, () => reject(err));
      });
  });
}

async function main() {
  console.log("=== CPRecal: Local DynamoDB Installer ===");

  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const jarPath = path.join(BIN_DIR, "DynamoDBLocal.jar");
  if (fs.existsSync(jarPath)) {
    console.log(`✅ DynamoDBLocal.jar already exists at: ${jarPath}`);
    console.log("Setup complete. You can run DynamoDB Local using: npm run db:local");
    return;
  }

  console.log(`Downloading DynamoDB Local from ${TAR_URL}...`);
  try {
    await downloadFile(TAR_URL, TAR_PATH);
    console.log("Download complete. Extracting archive...");

    // Extract using native Windows bsdtar
    execSync(`tar -xzf "${TAR_PATH}" -C "${BIN_DIR}"`, { stdio: "inherit" });

    // Cleanup tar file
    if (fs.existsSync(TAR_PATH)) {
      fs.unlinkSync(TAR_PATH);
    }

    console.log(`✅ DynamoDB Local successfully installed to: ${BIN_DIR}`);
    console.log(`✅ Data directory verified at: ${DATA_DIR}`);
  } catch (err) {
    console.error("❌ Failed to install DynamoDB Local:", err.message);
    process.exit(1);
  }
}

main();
