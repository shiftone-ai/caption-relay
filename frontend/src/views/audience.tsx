import { audienceHierarchy } from "../events/hierarchy";

export function AudienceView({ text }: { text: string }) {
  return (
    <audienceHierarchy.Scope name="audience-screen">
      <main className="grid min-h-svh place-items-center bg-neutral-950 text-white">
        <div id="caption" className="max-w-[1100px] p-[8vw] text-[clamp(34px,6vw,80px)] leading-[1.35] font-bold">{text}</div>
      </main>
    </audienceHierarchy.Scope>
  );
}
