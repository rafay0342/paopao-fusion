import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Play PaoPao Fusion",
  description: "Launch PaoPao Fusion: The Shattered Crown.",
};

export default function Home() {
  return (
    <main className="launch-shell">
      <meta httpEquiv="refresh" content="0;url=/classic/index.html" />
      <div className="launch-card" role="status" aria-live="polite">
        <span className="launch-orb" aria-hidden="true" />
        <p>PAOPAO FUSION</p>
        <h1>Opening The Shattered Crown…</h1>
        <a href="/classic/index.html">PLAY NOW</a>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: 'window.location.replace("/classic/index.html");',
        }}
      />
    </main>
  );
}
