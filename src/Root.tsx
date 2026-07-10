import "./index.css";
import { Composition } from "remotion";
import { HelloWorld, myCompSchema } from "./HelloWorld";
import { Logo, myCompSchema2 } from "./HelloWorld/Logo";
import { KavalIntro, kavalIntroSchema } from "./KavalIntro";
import {
  KavalPromo,
  KavalPromoShort,
  KavalPromoWide,
  kavalPromoSchema,
} from "./KavalPromo";
import { AINews, aiNewsSchema, calculateAINewsMetadata } from "./AINews";
import { Quiz, quizSchema, calculateQuizMetadata, sampleQuiz } from "./Quiz";
import { AINewsThumbnail, thumbnailSchema } from "./AINews/Thumbnail";
import {
  sampleAINews,
  sampleAITools,
  sampleThumbnail,
  sampleToolsThumbnail,
} from "./AINews/sample";

// Each <Composition> is an entry in the sidebar!

const promoDefaults = {
  appNameKn: "ಕಾವಲ್",
  appNameEn: "Kaval",
  tagline: "ನಿಮ್ಮ ಫೋನ್‌ನ ಕಾವಲುಗಾರ",
  cta: "Play Store ನಲ್ಲಿ ಉಚಿತ",
  music: "", // drop a file in public/ and set to e.g. "music.mp3"
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* ---------- Faceless AI-news channel templates ---------- */}
      {/* Long-form 16:9 — duration is derived from the scenes[] data */}
      <Composition
        id="AINews"
        component={AINews}
        durationInFrames={870}
        fps={30}
        width={1920}
        height={1080}
        schema={aiNewsSchema}
        defaultProps={sampleAINews}
        calculateMetadata={calculateAINewsMetadata}
      />
      {/* Vertical 9:16 cut for Shorts — same data, captions burned on */}
      <Composition
        id="AINewsShort"
        component={AINews}
        durationInFrames={870}
        fps={30}
        width={1080}
        height={1920}
        schema={aiNewsSchema}
        defaultProps={{ ...sampleAINews, showCaptions: true }}
        calculateMetadata={calculateAINewsMetadata}
      />
      {/* Pillar 2: Tool Breakdown — same component, different data */}
      <Composition
        id="AIToolsBreakdown"
        component={AINews}
        durationInFrames={870}
        fps={30}
        width={1920}
        height={1080}
        schema={aiNewsSchema}
        defaultProps={sampleAITools}
        calculateMetadata={calculateAINewsMetadata}
      />
      <Composition
        id="AIToolsShort"
        component={AINews}
        durationInFrames={870}
        fps={30}
        width={1080}
        height={1920}
        schema={aiNewsSchema}
        defaultProps={{ ...sampleAITools, showCaptions: true }}
        calculateMetadata={calculateAINewsMetadata}
      />
      {/* Current-affairs QUIZ — long (16:9) + Short (9:16). Duration derived from #questions. */}
      <Composition
        id="QuizLong"
        component={Quiz}
        durationInFrames={1200}
        fps={30}
        width={1920}
        height={1080}
        schema={quizSchema}
        defaultProps={sampleQuiz}
        calculateMetadata={calculateQuizMetadata}
      />
      <Composition
        id="QuizShort"
        component={Quiz}
        durationInFrames={1200}
        fps={30}
        width={1080}
        height={1920}
        schema={quizSchema}
        defaultProps={sampleQuiz}
        calculateMetadata={calculateQuizMetadata}
      />
      {/* Thumbnails — render as stills: npx remotion still AINewsThumbnail out/thumb.png */}
      <Composition
        id="AINewsThumbnail"
        component={AINewsThumbnail}
        durationInFrames={1}
        fps={30}
        width={1280}
        height={720}
        schema={thumbnailSchema}
        defaultProps={sampleThumbnail}
      />
      <Composition
        id="AIToolsThumbnail"
        component={AINewsThumbnail}
        durationInFrames={1}
        fps={30}
        width={1280}
        height={720}
        schema={thumbnailSchema}
        defaultProps={sampleToolsThumbnail}
      />

      {/* Full vertical promo — 16s, 1080x1920 */}
      <Composition
        id="KavalPromo"
        component={KavalPromo}
        durationInFrames={480}
        fps={30}
        width={1080}
        height={1920}
        schema={kavalPromoSchema}
        defaultProps={promoDefaults}
      />
      {/* Short vertical cut for Shorts/Reels/AdMob — ~9s, 1080x1920 */}
      <Composition
        id="KavalPromoShort"
        component={KavalPromoShort}
        durationInFrames={270}
        fps={30}
        width={1080}
        height={1920}
        schema={kavalPromoSchema}
        defaultProps={promoDefaults}
      />
      {/* Landscape promo for YouTube in-stream ads — 17s, 1920x1080 */}
      <Composition
        id="KavalPromoWide"
        component={KavalPromoWide}
        durationInFrames={510}
        fps={30}
        width={1920}
        height={1080}
        schema={kavalPromoSchema}
        defaultProps={promoDefaults}
      />
      <Composition
        id="KavalIntro"
        component={KavalIntro}
        durationInFrames={180}
        fps={30}
        width={1080}
        height={1920}
        schema={kavalIntroSchema}
        defaultProps={{
          appNameKn: "ಕಾವಲ್",
          appNameEn: "Kaval",
          tagline: "ನಿಮ್ಮ ಫೋನ್‌ನ ಕಾವಲುಗಾರ",
          footer: "ಉಚಿತ • ಕನ್ನಡದಲ್ಲಿ",
          chips: [
            "ಫೋನ್ ಸ್ಕ್ಯಾನ್",
            "ಬ್ರೀಚ್ ಪರಿಶೀಲನೆ",
            "ವೈಫೈ ಸುರಕ್ಷತೆ",
            "ಪಾಸ್‌ವರ್ಡ್",
            "ಲಿಂಕ್ ಸುರಕ್ಷತೆ",
          ],
          scriptFont: "kannada" as const,
        }}
      />
      {/* English cut of the intro — same animation, Latin copy */}
      <Composition
        id="KavalIntroEn"
        component={KavalIntro}
        durationInFrames={180}
        fps={30}
        width={1080}
        height={1920}
        schema={kavalIntroSchema}
        defaultProps={{
          appNameKn: "Kaval",
          appNameEn: "",
          tagline: "The guardian of your phone",
          footer: "Free • Coming soon on Play Store • Available in multiple languages",
          chips: [
            "Phone Scan",
            "Breach Check",
            "Wi-Fi Safety",
            "Passwords",
            "Link Safety",
          ],
          scriptFont: "latin" as const,
        }}
      />
      <Composition
        // You can take the "id" to render a video:
        // npx remotion render HelloWorld
        id="HelloWorld"
        component={HelloWorld}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        // You can override these props for each render:
        // https://www.remotion.dev/docs/parametrized-rendering
        schema={myCompSchema}
        defaultProps={{
          titleText: "Welcome to Remotion",
          titleColor: "#000000",
          logoColor1: "#91EAE4",
          logoColor2: "#86A8E7",
        }}
      />

      {/* Mount any React component to make it show up in the sidebar and work on it individually! */}
      <Composition
        id="OnlyLogo"
        component={Logo}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        schema={myCompSchema2}
        defaultProps={{
          logoColor1: "#91dAE2" as const,
          logoColor2: "#86A8E7" as const,
        }}
      />
    </>
  );
};
