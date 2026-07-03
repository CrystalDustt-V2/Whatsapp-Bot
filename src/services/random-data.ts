const JOKES = [
  "Why don't scientists trust atoms? Because they make up everything!",
  "Why did the scarecrow win an award? Because he was outstanding in his field!",
  "What do you call fake spaghetti? An impasta!",
  "Why did the bicycle fall over? Because it was two tired!",
  "What do you get when you cross a snowman and a vampire? Frostbite!",
  "Why don't eggs tell jokes? They'd crack each other up!",
  "What do you call a bear with no teeth? A gummy bear!",
  "Why did the math book look sad? Because it had too many problems!",
  "What do you call a fish wearing a bowtie? Sofishticated!",
  "Why don't skeletons fight each other? They don't have the guts!",
];

const QUOTES = [
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Innovation distinguishes between a leader and a follower.", author: "Steve Jobs" },
  { text: "Life is what happens when you're busy making other plans.", author: "John Lennon" },
  { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "The journey of a thousand miles begins with one step.", author: "Lao Tzu" },
  { text: "That which does not kill us makes us stronger.", author: "Friedrich Nietzsche" },
  { text: "You only live once, but if you do it right, once is enough.", author: "Mae West" },
  { text: "Be the change that you wish to see in the world.", author: "Mahatma Gandhi" },
];

const MEMES = [
  "When you realize it's Monday tomorrow 😭",
  "Me: I'll wake up early tomorrow\nAlso me: hits snooze 5 times",
  "When the Wi-Fi goes out during a game 🎮",
  "Me trying to adult: burns toast, spills coffee, forgets keys",
  "When you see your ex with someone worse than you 😏",
  "Teacher: the test isn't that hard\nThe test: what is the square root of a triangle?",
  "Me after eating a whole pizza: I'll start my diet tomorrow",
  "When you finally finish a long video game 🎉",
  "My wallet after payday vs my wallet 3 days later 💸",
  "When someone says 'I have a joke' and it's actually funny 😂",
];

const PICKUP_LINES = [
  "Are you a parking ticket? Because you've got 'fine' written all over you!",
  "Are you a Wi-Fi signal? Because I'm feeling a connection!",
  "Do you have a name, or can I call you mine?",
  "Are you a magician? Because whenever I look at you, everyone else disappears!",
  "Is your name Google? Because you have everything I've been searching for!",
  "Are you a campfire? Because you're hot and I want s'more!",
  "Do you believe in love at first sight, or should I walk by again?",
  "Are you a bank loan? Because you've got my interest!",
  "Is there an airport nearby, or is that just my heart taking off?",
  "You must be tired because you've been running through my mind all day!",
];

const FACTS = [
  "A group of flamingos is called a 'flamboyance'.",
  "Octopuses have three hearts and blue blood.",
  "Honey never spoils. Archaeologists have found 3000-year-old honey in Egyptian tombs!",
  "A single cloud can weigh more than 1 million pounds.",
  "Sharks have been around for 400 million years - longer than trees!",
  "Bananas are berries, but strawberries aren't!",
  "A day on Venus is longer than its year.",
  "The shortest war in history lasted only 38-45 minutes (Anglo-Zanzibar War, 1896).",
  "You can't hum while holding your nose closed.",
  "The Great Wall of China is visible from space with the naked eye is a myth!",
];

const TRUTHS = [
  "What's the most embarrassing thing that's ever happened to you?",
  "What's the biggest lie you've ever told?",
  "What's something you're ashamed to admit you love?",
  "What's the most childish thing you still do?",
  "What's a secret you've never told anyone?",
  "What's the worst thing you've ever done at work/school?",
  "What's something you pretend to like but actually hate?",
  "What's the most trouble you've ever gotten in?",
  "What's your biggest regret?",
  "What's something you've done that you're still proud of?",
];

const DARES = [
  "Dance for 30 seconds without music!",
  "Sing a song in a silly voice!",
  "Call someone and say 'I love you'!",
  "Do 10 jumping jacks right now!",
  "Send a silly selfie to the group!",
  "Say everything in a robot voice for the next 5 minutes!",
  "Try to lick your elbow!",
  "Do your best impression of a famous person!",
  "Wear your socks on your hands for 1 minute!",
  "Recite the alphabet backwards as fast as you can!",
];

const WOULD_YOU_RATHER = [
  "Would you rather be able to fly or be invisible?",
  "Would you rather have a pet dinosaur or a pet dragon?",
  "Would you rather live in space or under the sea?",
  "Would you rather be able to talk to animals or speak all languages?",
  "Would you rather have unlimited pizza or unlimited tacos forever?",
  "Would you rather be a famous singer or a famous actor?",
  "Would you rather have no phone or no internet for a month?",
  "Would you rather be able to teleport or time travel?",
  "Would you rather be the funniest person or the smartest person in the room?",
  "Would you rather never have to sleep or never have to eat again?",
];

const ROASTS = [
  "You're proof that loading screens can become people.",
  "Your Wi-Fi has more stable connections than your decisions.",
  "You bring everyone together, mostly to ask what just happened.",
  "You're not lazy, you're just on a very aggressive power-saving mode.",
  "Your brain has a search bar, but the indexer is still sleeping.",
  "You have main character energy in a buffering episode.",
  "If confidence was RAM, you would be running on swap memory.",
  "You are the human version of a low battery warning.",
];

const SHIP_MESSAGES = [
  'solid duo',
  'chaotic but promising',
  'best kept as a meme',
  'surprisingly compatible',
  'dangerously cute',
  'needs more side quests',
  'legendary timeline',
  'better after coffee',
];

const NICKNAME_ADJECTIVES = [
  'Silent',
  'Neon',
  'Lucky',
  'Cosmic',
  'Rapid',
  'Velvet',
  'Pixel',
  'Nova',
  'Solar',
  'Misty',
];

const NICKNAME_NOUNS = [
  'Rider',
  'Coder',
  'Ninja',
  'Wizard',
  'Pilot',
  'Runner',
  'Spark',
  'Comet',
  'Echo',
  'Byte',
];

const FIRST_NAMES = [
  'Alex',
  'Rina',
  'Kai',
  'Maya',
  'Dion',
  'Salsa',
  'Nadia',
  'Rafi',
  'Luna',
  'Arga',
];

const LAST_NAMES = [
  'Pratama',
  'Wijaya',
  'Hartono',
  'Santoso',
  'Saputra',
  'Lestari',
  'Kusuma',
  'Aditya',
  'Mahendra',
  'Putri',
];

const JOBS = [
  'Graphic Designer',
  'Frontend Developer',
  'Content Creator',
  'Data Analyst',
  'Cafe Owner',
  'Photographer',
  'Game Tester',
  'Digital Marketer',
];

const CITIES = [
  'Makassar',
  'Jakarta',
  'Bandung',
  'Surabaya',
  'Yogyakarta',
  'Denpasar',
  'Medan',
  'Balikpapan',
  'Bima',
  'Dompu',
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export class RandomDataService {
  getJoke(): string {
    return pick(JOKES);
  }

  getQuote(): { text: string; author: string } {
    return pick(QUOTES);
  }

  getMeme(): string {
    return pick(MEMES);
  }

  getPickupLine(): string {
    return pick(PICKUP_LINES);
  }

  getFact(): string {
    return pick(FACTS);
  }

  getTruth(): string {
    return pick(TRUTHS);
  }

  getDare(): string {
    return pick(DARES);
  }

  getWouldYouRather(): string {
    return pick(WOULD_YOU_RATHER);
  }

  getRoast(): string {
    return pick(ROASTS);
  }

  getShipMessage(): string {
    return pick(SHIP_MESSAGES);
  }

  getNickname(): string {
    const suffix = Math.floor(100 + Math.random() * 900);
    return `${pick(NICKNAME_ADJECTIVES)}${pick(NICKNAME_NOUNS)}${suffix}`;
  }

  getFakeIdentity() {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const birthYear = Math.floor(1985 + Math.random() * 21);
    return {
      name: `${firstName} ${lastName}`,
      age: new Date().getFullYear() - birthYear,
      city: pick(CITIES),
      job: pick(JOBS),
      email: `${firstName}.${lastName}${Math.floor(Math.random() * 1000)}@example.com`.toLowerCase(),
    };
  }

  getHexColor(): { hex: string; rgb: string } {
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    const hex = `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    return { hex, rgb: `rgb(${r}, ${g}, ${b})` };
  }
}

export const randomData = new RandomDataService();
export default randomData;
