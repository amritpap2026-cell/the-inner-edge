import { generateText } from 'ai'
import { NextResponse } from 'next/server'

function createFallbackPackage(topic: string, language: string) {
  const translations = {
    English: {
      title: `${topic}: The Cosmic Mystery Scientists Are Solving`,
      description: `Explore ${topic} in this accessible Cosmos lesson. We break down the science, the latest NASA discoveries, and the questions researchers are still investigating.\n\nThis educational video is designed for curious learners everywhere. NASA is a source of public information; this channel is independent and not endorsed by NASA.`,
      hook: `What if ${topic.toLowerCase()} changes what we know about our place in the universe?`,
      thumbnailText: 'THE COSMIC MYSTERY',
    },
    'हिन्दी': {
      title: `${topic}: ब्रह्मांड का वह रहस्य जिसे वैज्ञानिक सुलझा रहे हैं`,
      description: `${topic} को आसान भाषा में समझिए। इस Cosmos पाठ में NASA की सार्वजनिक जानकारी, नई खोजों और वैज्ञानिकों के अनसुलझे सवालों को समझाया गया है।\n\nयह वीडियो सभी जिज्ञासु विद्यार्थियों के लिए है। यह चैनल स्वतंत्र है और NASA द्वारा समर्थित नहीं है।`,
      hook: `क्या ${topic} ब्रह्मांड में हमारी जगह के बारे में सोचने का तरीका बदल सकता है?`,
      thumbnailText: 'ब्रह्मांड का रहस्य',
    },
    'नेपाली': {
      title: `${topic}: वैज्ञानिकहरूले खोजिरहेको ब्रह्माण्डको रहस्य`,
      description: `${topic} लाई सजिलो भाषामा बुझ्नुहोस्। यस Cosmos पाठमा NASA का सार्वजनिक जानकारी, नयाँ खोज र वैज्ञानिकहरूले अध्ययन गरिरहेका प्रश्नहरू समेटिएका छन्।\n\nयो भिडियो जिज्ञासु सिक्नेहरूका लागि हो। यो च्यानल स्वतन्त्र हो र NASA बाट समर्थित छैन।`,
      hook: `के ${topic} ले ब्रह्माण्डमा हाम्रो स्थानबारे बुझाइ बदल्न सक्छ?`,
      thumbnailText: 'ब्रह्माण्डको रहस्य',
    },
  } as const
  const copy = translations[language as keyof typeof translations] ?? translations.English
  return { ...copy, tags: ['NASA', 'space exploration', 'cosmos', topic, 'astronomy', 'science education', '宇宙'], keywords: [topic, 'NASA discoveries', 'space science', 'astronomy', 'universe'] }
}

export async function POST(request: Request) {
  const { topic, language = 'English' } = await request.json()

  if (!topic || typeof topic !== 'string' || topic.trim().length < 3) {
    return NextResponse.json({ error: 'Please enter a topic.' }, { status: 400 })
  }

  try {
    const result = await generateText({
      model: 'google/gemini-2.5-flash',
      prompt: `You are a YouTube education strategist for Cosmos, a NASA and space exploration channel. Create a compelling video package in ${language} about: ${topic.trim()}.

Return valid JSON only with these keys:
- title: an intriguing YouTube title
- description: a useful, accurate 2-3 paragraph description with a clear educational tone
- tags: an array of 10-15 SEO tags
- keywords: an array of 5-8 search keywords
- hook: a one-sentence opening hook
- thumbnailText: 3-5 words for thumbnail text

Do not claim NASA endorsement. Be factual and accessible for curious learners.`,
    })

    const text = result.text.replace(/^```json\s*|\s*```$/g, '').trim()
    return NextResponse.json(JSON.parse(text))
  } catch (error) {
    console.error('[v0] AI generation unavailable, using free fallback:', error)
    return NextResponse.json({ ...createFallbackPackage(topic.trim(), language), fallback: true })
  }
}
