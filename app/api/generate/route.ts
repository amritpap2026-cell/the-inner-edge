import { NextResponse } from 'next/server'

type VideoPackage = {
  title: string
  description: string
  tags: string[]
  keywords: string[]
  hook: string
  thumbnailText: string
}

function createFallbackPackage(topic: string, language: string): VideoPackage {
  if (language === 'हिन्दी') {
    return {
      title: `${topic}: वैज्ञानिकों का ब्रह्मांडीय रहस्य`,
      description: `${topic} को आसान भाषा में समझिए। इस शैक्षिक वीडियो में NASA की सार्वजनिक जानकारी और अंतरिक्ष विज्ञान को सरल तरीके से समझाया गया है।\n\nयह स्वतंत्र शैक्षिक चैनल है और NASA द्वारा समर्थित नहीं है।`,
      tags: ['NASA', 'अंतरिक्ष', 'ब्रह्मांड', 'विज्ञान शिक्षा', topic],
      keywords: [topic, 'NASA discoveries', 'space science', 'astronomy'],
      hook: `क्या ${topic} ब्रह्मांड के बारे में हमारी समझ बदल सकता है?`,
      thumbnailText: 'ब्रह्मांड का रहस्य',
    }
  }

  if (language === 'नेपाली') {
    return {
      title: `${topic}: वैज्ञानिकहरूले खोजिरहेको ब्रह्माण्डको रहस्य`,
      description: `${topic} लाई सजिलो भाषामा बुझ्नुहोस्। यस शैक्षिक भिडियोमा NASA का सार्वजनिक जानकारी र अन्तरिक्ष विज्ञानलाई सरल रूपमा प्रस्तुत गरिएको छ।\n\nयो स्वतन्त्र शैक्षिक च्यानल हो र NASA बाट समर्थित छैन।`,
      tags: ['NASA', 'अन्तरिक्ष', 'ब्रह्माण्ड', 'विज्ञान शिक्षा', topic],
      keywords: [topic, 'NASA discoveries', 'space science', 'astronomy'],
      hook: `के ${topic} ले ब्रह्माण्डबारे हाम्रो बुझाइ बदल्न सक्छ?`,
      thumbnailText: 'ब्रह्माण्डको रहस्य',
    }
  }

  return {
    title: `${topic}: The Cosmic Mystery Scientists Are Solving`,
    description: `Explore ${topic} in this accessible space science lesson. We explain the science, NASA's public information, and the questions researchers are still investigating.\n\nThis channel is independent and not endorsed by NASA.`,
    tags: ['NASA', 'space exploration', 'cosmos', 'astronomy', 'science education', topic],
    keywords: [topic, 'NASA discoveries', 'space science', 'astronomy'],
    hook: `What if ${topic.toLowerCase()} changes what we know about our place in the universe?`,
    thumbnailText: 'THE COSMIC MYSTERY',
  }
}

function parsePackage(text: string): VideoPackage {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim()
  const parsed = JSON.parse(cleaned) as Partial<VideoPackage>
  if (!parsed.title || !parsed.description || !Array.isArray(parsed.tags) || !Array.isArray(parsed.keywords) || !parsed.hook || !parsed.thumbnailText) {
    throw new Error('Gemini returned an incomplete video package')
  }
  return parsed as VideoPackage
}

export async function POST(request: Request) {
  let body: { topic?: unknown; language?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
  const language = body.language === 'हिन्दी' || body.language === 'नेपाली' ? body.language : 'English'
  if (topic.length < 3 || topic.length > 300) {
    return NextResponse.json({ error: 'Please enter a topic between 3 and 300 characters.' }, { status: 400 })
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    console.error('[v0] GEMINI_API_KEY is missing from the server environment')
    return NextResponse.json({ ...createFallbackPackage(topic, language), fallback: true })
  }

  const prompt = `Create a YouTube SEO package for an educational NASA and space exploration channel. Topic: ${topic}. Language: ${language}.
Return JSON only with exactly these keys: title (string), description (2-3 useful paragraphs), tags (array of 10 strings), keywords (array of 6 strings), hook (one sentence), thumbnailText (3-5 words). Be factual, accessible, and never claim NASA endorsement.`
  const models = ['gemini-2.0-flash', 'gemini-2.0-flash-lite']

  for (const model of models) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.7 } }),
      })
      if (!response.ok) {
        console.error(`[v0] Gemini ${model} returned ${response.status}`)
        continue
      }
      const payload = await response.json()
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
      if (typeof text === 'string') return NextResponse.json(parsePackage(text))
    } catch (error) {
      console.error(`[v0] Gemini ${model} request failed`, error instanceof Error ? error.message : 'unknown error')
    } finally {
      clearTimeout(timeout)
    }
  }

  return NextResponse.json({ ...createFallbackPackage(topic, language), fallback: true })
}
