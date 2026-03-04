import puppeteer from "puppeteer";

export async function webSearch(query) {

  console.log("🌐 Browsing for:", query);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    );

    /* ================= SEARCH BING ================= */

    await page.goto(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      { waitUntil: "networkidle2", timeout: 30000 }
    );

    // Extract only REAL links (ignore bing redirect links)
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("li.b_algo h2 a"));
      return anchors
        .map(a => a.href)
        .filter(href => href && !href.includes("bing.com"));
    });

    if (!links.length) {
      await browser.close();
      return "No valid search results found.";
    }

    const cleanUrl = links[0];

    console.log("🔗 Opening:", cleanUrl);

    /* ================= OPEN ACTUAL SITE ================= */

    await page.goto(cleanUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    /* ================= EXTRACT TEXT ================= */

    const pageText = await page.evaluate(() => {
      return document.body.innerText;
    });

    await browser.close();

    if (!pageText || pageText.length < 200) {
      return "Could not extract enough content.";
    }

    return pageText.substring(0, 5000);

  } catch (err) {
    await browser.close();
    console.error("Browsing error:", err.message);
    return "Web browsing failed.";
  }
}