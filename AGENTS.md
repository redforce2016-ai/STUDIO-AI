# قوانین ساخت و معماری پروژه (AGENTS.md)

## قانون طلایی اول: جستجوی اجباری در گیت‌هاب و ردیت قبل از ساخت هر قابلیت (Open-Source First)
- **همیشه قبل از اینکه یک قابلیت، ابزار یا سیستم جدید به پروژه اضافه شود، ابتدا باید مخازن گیت‌هاب (GitHub)، انجمن‌های مرتبط (مانند Reddit) و مستندات رسمی اکوسیستم (مانند LangChain / LangGraph / Playwright) بررسی شوند.**
- **عدم اختراع دوباره چرخ (Do Not Reinvent the Wheel):** اگر یک پروژه، کتابخانه، چارچوب یا ابزار متن‌باز آماده، قدرتمند و استاندارد وجود دارد — مانند **Agent Browserهای استاندارد** (`vercel-labs/agent-browser`، `browser-use`، `Stagehand`)، `playwright-core`، `PlaywrightBrowserToolkit` در LangChain، پچ‌های ضدتشخیص `patchright` / `rebrowser-patches`، و گراف‌های وضعیت `LangGraph` — **الزامی است که از همان پروژه متن‌باز آماده استفاده شود** و متناسب با نیازهای نرم‌افزار شخصی‌سازی گردد.
- تنها در صورتی مجاز به پیاده‌سازی یک بخش از صفر هستیم که پس از بررسی دقیق گیت‌هاب و انجمن‌های مرتبط، هیچ ابزار آماده‌ای برای آن منطق خاص وجود نداشته باشد.

---

## معماری مرورگر ایجنت و اتوماسیون چندپروفایله (LangGraph + vercel-labs/agent-browser)

بر اساس بررسی پروژه‌های متن‌باز برتر گیت‌هاب و ردیت (`vercel-labs/agent-browser`، `browser-use/browser-use`، `browserbase/stagehand` و `LangChain / LangGraph`)، معماری مرورگر ایجنت در این پروژه بر پایه اجزای استاندارد زیر بنا شده است:

1. **موتور رسمی متن‌باز `vercel-labs/agent-browser` (Chromium CDP + Persistent Profiles + Accessibility `@eN` Refs):**
   - جایگزینی کامل مرورگر قبلی با پکیج آماده **`agent-browser`** (`--session <id>` و `--profile <userDataDir>`) متصل به باینری واقعی Chromium/Chrome روی سیستم.
   - استخراج درخت دسترسی صفحه (`snapshot -i --json` -> عناصر `@e1`, `@e2`, ...)، پر کردن فرم‌ها (`fill`, `select`), کلیک دقیق روی عناصر (`click @eN`), ثبت‌نام/ورود خودکار در وب‌سایت‌ها (`register`)، و خواندن محتوا (`read`).
   - هر یک از **۱۰ اکانت جیمیل** دارای یک پوشه پروفایل دائمی مجزا (`output/browser_profiles/prof_google_1..10`) است تا کوکی‌ها، توکن‌های نشست (Session) و امتیاز اعتماد Cloudflare Turnstile حفظ شود.

2. **لایه ضدتشخیص و عبور از موانع (Stealth Init Script & Obstacle Solver):**
   - تزریق اسکریپت‌های Stealth از طریق `AGENT_BROWSER_INIT_SCRIPTS` (`output/browser_profiles/stealth_init.js`) برای مخفی‌سازی `navigator.webdriver` و شبیه‌سازی کامل `window.chrome.runtime`.
   - تشخیص خودکار بنرهای کوکی و چک‌باکس‌های Cloudflare Turnstile / `I'm not a robot` از روی `@eN` refs و کلیک واقعی جهت عبور از موانع.

3. **مدیریت ۱۰ اکانت جیمیل و چرخش خودکار سهمیه روزانه (10-Gmail Pool & Quota Rotator):**
   - نگهداری ۱۰ اکانت جیمیل متصل به وب‌سایت‌های تولید محتوا (**Google Labs Flow** با مدل‌های **Veo 2 / Omni Flash / Imagen 3**، وب‌سایت **Leonardo.ai**، Kling و Runway).
   - ثبت مصرف روزانه هر اکانت (`usedToday` / `dailyLimit`). به محض پر شدن سهمیه یک اکانت، گراف LangGraph به صورت خودکار به اکانت فعال بعدی (`Switch Profile`) سوییچ می‌کند.

4. **ایجنت نهایی‌ساز پرامپت و تنظیم‌کننده دقیق پارامترهای سایت (Prompt Refiner & UI Configurator Node):**
   - قبل از ارسال هر پرامپت برای ساخت تصویر یا ویدیو، گره `prompt_refiner_node` پرامپت خام شات را به پرامپت مهندسی‌شده، سینمایی و قطعی (همراه با جزئیات نور، لنز، حرکت دوربین و کیفیت) تبدیل و قفل می‌کند.
   - گره `site_configurator_node` متناسب با نوع نیاز شات (`text_to_image`، `image_to_video` یا `text_to_video`) وارد تنظیمات سایت مقصد (مثلاً در Google Flow انتخاب مدل **Veo 2** یا **Omni Flash**، نسبت تصویر `9:16` یا `16:9` و رزولوشن) شده و خروجی شات را تولید می‌کند.
