import Icon, { type IconName } from "../components/Icon";

const STEPS: { icon: IconName; tone?: "seeker" | "coin"; title: string; text: string }[] = [
  { icon: "users", title: "Get into a room", text: "One person creates a game and shares the 4-letter code. Everyone else joins with it. The host sets the rules." },
  { icon: "run", title: "Hiders run", text: "Hiders get a head start to disappear into the play area. Seekers wait at the start." },
  { icon: "radar", tone: "seeker", title: "Seekers get pinged", text: "Every so often, seekers see where each hider was at that moment. Then they have to go and find them." },
  { icon: "hand", tone: "seeker", title: "Tag them", text: "Catch a hider for real, then they tap “I got tagged”, or you scan the QR code on their screen." },
  { icon: "coin", tone: "coin", title: "Safe zones pay coins", text: "Amber circles pop up for a few minutes. Hiders inside earn coins, but everyone can see the zones, so they're risky." },
  { icon: "bag", tone: "coin", title: "Spend on power-ups", text: "Skip a ping, drop a decoy, black out the seekers' maps, or bring a friend back into the game." },
  { icon: "trophy", title: "Win", text: "Hiders win if anyone survives the timer. Seekers win if they catch everyone. Then watch the replay of everyone's paths." },
  { icon: "shield", title: "Stay safe", text: "Watch for traffic, stick to the play area, and keep the game open with your screen on so your location keeps sending." },
];

export default function HowToPlay() {
  return (
    <div className="howto">
      {STEPS.map((s) => (
        <div key={s.title} className="howto-item">
          <span className={`howto-icon ${s.tone ? `howto-icon--${s.tone}` : ""}`}>
            <Icon name={s.icon} size={22} />
          </span>
          <div>
            <b>{s.title}</b>
            <p>{s.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
