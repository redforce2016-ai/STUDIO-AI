import type { ShotCompositionPlan, ShotSpec } from "../../../src/types/videoPipeline.js";

export interface GoldenShotExample {
  name: string;
  spec: Partial<ShotSpec>;
  plan: ShotCompositionPlan;
}

export const GOLDEN_SHOT_EXAMPLES: GoldenShotExample[] = [
  {
    name: "hero_intro_hook",
    spec: {
      shot_id: "shot_01",
      duration_sec: 4,
      intent: "جذب توجه فوری مخاطب صنعتی درباره تفاوت لوله بدون درز مانیسمان با لوله درزدار",
      visual: {
        layout: "hero",
        primary_subject: "تیتر قلاب + شمارنده تحمل فشار",
        background: "گرادیان تیره صنعتی با نور تاکیدی کهربایی",
        foreground_elements: ["Headline", "Counter", "CaptionTrack"],
        camera_motion: "push-in",
        animation_notes: "ورود فوری با spring سریع و شمارنده ۴۰۰ بار",
      },
    },
    plan: {
      shot_id: "shot_01",
      duration_sec: 4,
      fps: 30,
      width: 1080,
      height: 1920,
      palette_preset: "studio_amber",
      palette: ["#0B0D11", "#14171F", "#F59E0B"],
      transition_in: "crossfade",
      camera_motion: "push-in",
      caption_text: "چرا یک درز جوش کوچک در فشار بالا فاجعه می‌سازد؟",
      nodes: [
        { component: "Background", props: { showGrid: true, glowPosition: "top" } },
        {
          component: "Headline",
          props: {
            badge: "استاندارد خطوط پرفشار",
            text: "راز تحمل فشار بدون یک میلی‌متر درز جوش",
            align: "center",
          },
        },
        {
          component: "Counter",
          props: {
            value: 400,
            suffix: " بار",
            label: "حداکثر فشار کاری ایمن در خطوط بخار",
          },
        },
      ],
    },
  },
  {
    name: "industrial_bar_chart",
    spec: {
      shot_id: "shot_02",
      duration_sec: 5,
      intent: "نمایش عددی مقایسه مقاومت فشاری بین رده ۴۰، رده ۸۰ و لوله درزدار معمولی",
      visual: {
        layout: "bar_chart",
        primary_subject: "نمودار میله‌ای مقایسه تحمل فشار",
        background: "پس‌زمینه سرمه‌ای صنعتی",
        foreground_elements: ["Headline", "BarChart"],
        camera_motion: "static",
        animation_notes: "رشد تدریجی میله‌ها با spring",
      },
    },
    plan: {
      shot_id: "shot_02",
      duration_sec: 5,
      fps: 30,
      width: 1080,
      height: 1920,
      palette_preset: "slate_sky",
      palette: ["#0F172A", "#1E293B", "#38BDF8"],
      transition_in: "slide",
      camera_motion: "static",
      caption_text: "اختلاف مقاومت فشاری رده ۸۰ در برابر لوله درزدار معمولی",
      nodes: [
        { component: "Background", props: { showGrid: true, glowPosition: "center" } },
        {
          component: "Headline",
          props: {
            badge: "تست آزمایشگاهی فشار",
            text: "مقایسه مقاومت در خطوط صنعتی",
            align: "center",
          },
        },
        {
          component: "BarChart",
          props: {
            title: "حداکثر تحمل فشار ایمن (بار)",
            data: [
              { label: "مانیسمان رده ۸۰", value: 380, unit: "بار", highlight: true },
              { label: "مانیسمان رده ۴۰", value: 240, unit: "بار", highlight: false },
              { label: "لوله درزدار ERW", value: 115, unit: "بار", highlight: false },
            ],
          },
        },
      ],
    },
  },
  {
    name: "comparison_and_cta",
    spec: {
      shot_id: "shot_04",
      duration_sec: 4,
      intent: "مقایسه مستقیم خرید هوشمندانه و دعوت به اقدام برای دریافت لیست چک‌لیست بازرسی",
      visual: {
        layout: "cta",
        primary_subject: "کارت دعوت به اقدام و خلاصه مزیت",
        background: "پالت زمردی فنی",
        foreground_elements: ["CallToAction", "CaptionTrack"],
        camera_motion: "push-in",
        animation_notes: "تاکید ضربانی نرم روی دکمه CTA",
      },
    },
    plan: {
      shot_id: "shot_04",
      duration_sec: 4,
      fps: 30,
      width: 1080,
      height: 1920,
      palette_preset: "emerald_tech",
      palette: ["#061311", "#0F2420", "#10B981"],
      transition_in: "zoom",
      camera_motion: "push-in",
      caption_text: "کلمه مانیسمان را کامنت کنید تا چک‌لیست بازرسی ارسال شود",
      nodes: [
        { component: "Background", props: { showGrid: true, glowPosition: "bottom" } },
        {
          component: "CallToAction",
          props: {
            headline: "پیش از خرید عمده ریسک نکنید",
            actionLabel: "دریافت چک‌لیست تست و بازرسی",
            subnote: "این ویدیو را برای مهندسان خرید ارسال و ذخیره کنید",
          },
        },
      ],
    },
  },
];

export const COMPONENT_CATALOG_PROMPT = `کتابخانه کامپوننت‌های مجاز Remotion (هر شات فقط می‌تواند از این کامپوننت‌ها تشکیل شود):
1. Background: { showGrid?: boolean, glowPosition?: "top" | "center" | "bottom" } (همیشه اولین نود الزامی است)
2. Headline: { text: string (حداکثر ۱۰ کلمه فارسی خوانا), badge?: string, align?: "center" | "right" }
3. Subtitle: { text: string (حداکثر ۱۶ کلمه), align?: "center" | "right" }
4. BarChart: { title?: string, data: Array<{ label: string, value: number, unit?: string, highlight?: boolean }> }
5. LineChart: { title?: string, data: Array<{ label: string, value: number }> }
6. Counter: { value: number, label: string, prefix?: string, suffix?: string }
7. Card: { title: string, body: string, tag?: string }
8. FeatureGrid: { items: Array<{ title: string, description: string, metric?: string }> (حداکثر ۴ آیتم) }
9. Timeline: { steps: Array<{ stepLabel: string, title: string, detail: string }> (حداکثر ۴ مرحله) }
10. SplitScreen: { primaryTitle: string, primaryBody: string, secondaryTitle: string, secondaryBody: string }
11. Comparison: { left: { title, subtitle?, points: string[], metricLabel?, isWinner? }, right: { title, subtitle?, points: string[], metricLabel?, isWinner? } }
12. LogoReveal: { brandName: string, tagline?: string }
13. DeviceMockup: { title: string, lines: string[] }
14. CallToAction: { headline: string, actionLabel: string, subnote?: string }
15. CaptionTrack: { text: string } (در پایین کادر و داخل حاشیه امن رندر می‌شود)

قوانین حاکم بر طراحی:
- فونت Vazirmatn محلی با جهت RTL کامل و بدون letter-spacing اعمال می‌شود.
- برای جلوگیری از شلوغی و بیرون‌زدگی، در هر شات حداکثر ۲ تا ۴ کامپوننت محتوایی (به‌جز Background و CaptionTrack) قرار بده.
- هرگز متن انگلیسی یا اصطلاحات بی‌ربط جایگزین اعداد واقعی سناریو نکن.`;
