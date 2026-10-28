import type { OutreachChannel, OutreachLanguage } from "@/lib/config/domain";

export const TEMPLATE_PLACEHOLDERS = ["{{company}}", "{{category}}", "{{state}}"] as const;

interface TemplateText {
  subject: string | null;
  body: string;
}

/**
 * Template-mode drafts, used when no AI provider is configured. Every draft is labelled as a template.
 * Templates make no claims about sales, customers, testimonials or verification. Each one includes an opt-out.
 * Non-English text should be reviewed by a native speaker before use.
 */
const TEMPLATES: Record<OutreachLanguage, Record<OutreachChannel, TemplateText>> = {
  en: {
    email: {
      subject: "Bulk trade opportunities for {{category}} manufacturers in {{state}}",
      body: [
        "Dear {{company}} team,",
        "",
        "Bulkskart is a B2B bulk-trading marketplace that connects manufacturers with wholesalers, distributors and bulk buyers across India.",
        "",
        "We found {{company}} listed as a {{category}} manufacturer in {{state}}. We would like to invite you to register on Bulkskart to explore bulk trade opportunities. We cannot promise any sales or leads.",
        "",
        "If you would like more information, reply to this email. If you do not want to receive messages from us, reply with 'unsubscribe' and we will not contact you again.",
        "",
        "Regards,",
        "Bulkskart team",
        "https://bulkskart.com",
      ].join("\n"),
    },
    whatsapp: {
      subject: null,
      body: "Hello {{company}} team, this is Bulkskart, a B2B bulk-trading marketplace in India. We understand you manufacture {{category}} in {{state}}. We would like to invite you to register at https://bulkskart.com to explore bulk trade opportunities. Reply STOP to opt out of further messages.",
    },
    call_script: {
      subject: null,
      body: [
        "Opening: Hello, may I speak with the person in charge of sales at {{company}}? I am calling from Bulkskart, a B2B bulk-trading marketplace.",
        "Purpose: We work with manufacturers of {{category}} in {{state}} and would like to invite you to register on Bulkskart to explore bulk trade opportunities.",
        "Question: Would you be open to receiving a short registration link by message or email?",
        "If not interested: Thank you for your time. We will not contact you again. (Record the opt-out.)",
        "Do not promise sales, orders or revenue.",
      ].join("\n"),
    },
  },
  ta: {
    email: {
      subject: "{{state}} பகுதியில் {{category}} உற்பத்தியாளர்களுக்கான மொத்த வணிக வாய்ப்புகள்",
      body: [
        "அன்புள்ள {{company}} குழுவினருக்கு,",
        "",
        "Bulkskart என்பது இந்தியா முழுவதும் உற்பத்தியாளர்களை மொத்த வியாபாரிகள், விநியோகஸ்தர்கள் மற்றும் மொத்த வாங்குபவர்களுடன் இணைக்கும் B2B மொத்த வணிகத் தளம்.",
        "",
        "{{state}} பகுதியில் {{category}} உற்பத்தியாளராக {{company}} பட்டியலிடப்பட்டிருப்பதை நாங்கள் கண்டோம். மொத்த வணிக வாய்ப்புகளை ஆராய Bulkskart-இல் பதிவு செய்ய உங்களை அழைக்கிறோம். விற்பனை அல்லது வாடிக்கையாளர்கள் குறித்து உத்தரவாதம் எதுவும் நாங்கள் அளிக்கவில்லை.",
        "",
        "மேலும் தகவல் வேண்டுமெனில் இந்த மின்னஞ்சலுக்குப் பதிலளியுங்கள். இனி செய்திகள் வேண்டாம் என்றால் 'unsubscribe' என்று பதிலளியுங்கள்; அதன்பிறகு நாங்கள் தொடர்பு கொள்ள மாட்டோம்.",
        "",
        "அன்புடன்,",
        "Bulkskart குழு",
        "https://bulkskart.com",
      ].join("\n"),
    },
    whatsapp: {
      subject: null,
      body: "வணக்கம் {{company}} குழுவினரே, நான் Bulkskart, இந்தியாவின் B2B மொத்த வணிகத் தளத்திலிருந்து பேசுகிறோம். {{state}} பகுதியில் நீங்கள் {{category}} தயாரிப்பது எங்களுக்குத் தெரியும். மொத்த வணிக வாய்ப்புகளுக்காக https://bulkskart.com இல் பதிவு செய்ய அழைக்கிறோம். மேலும் செய்திகள் வேண்டாம் என்றால் STOP என்று பதிலளியுங்கள்.",
    },
    call_script: {
      subject: null,
      body: [
        "தொடக்கம்: வணக்கம், {{company}} விற்பனைப் பொறுப்பாளரிடம் பேசலாமா? Bulkskart நிறுவனத்திலிருந்து அழைக்கிறேன்.",
        "நோக்கம்: {{state}} பகுதியில் {{category}} உற்பத்தி செய்யும் நிறுவனங்களுடன் பணியாற்றுகிறோம். Bulkskart-இல் பதிவு செய்ய உங்களை அழைக்கிறோம்.",
        "கேள்வி: குறுஞ்செய்தி அல்லது மின்னஞ்சல் மூலம் பதிவு இணைப்பைப் பெற விருப்பமா?",
        "ஆர்வமில்லை என்றால்: நன்றி. இனி தொடர்பு கொள்ள மாட்டோம். (விலகலைப் பதிவு செய்யவும்.)",
        "விற்பனை, ஆர்டர் அல்லது வருவாய் குறித்து எந்த வாக்குறுதியும் அளிக்க வேண்டாம்.",
      ].join("\n"),
    },
  },
  hi: {
    email: {
      subject: "{{state}} में {{category}} निर्माताओं के लिए थोक व्यापार के अवसर",
      body: [
        "आदरणीय {{company}} टीम,",
        "",
        "Bulkskart एक B2B थोक-व्यापार मार्केटप्लेस है जो भारत भर के निर्माताओं को थोक विक्रेताओं, वितरकों और थोक खरीदारों से जोड़ता है।",
        "",
        "हमने पाया कि {{company}} {{state}} में {{category}} निर्माता के रूप में सूचीबद्ध है। थोक व्यापार के अवसर देखने के लिए हम आपको Bulkskart पर पंजीकरण का आमंत्रण देते हैं। हम बिक्री या लीड का कोई वादा नहीं करते।",
        "",
        "अधिक जानकारी के लिए इस ईमेल का उत्तर दें। यदि आप हमारे संदेश नहीं चाहते, तो 'unsubscribe' लिखकर उत्तर दें; उसके बाद हम संपर्क नहीं करेंगे।",
        "",
        "सादर,",
        "Bulkskart टीम",
        "https://bulkskart.com",
      ].join("\n"),
    },
    whatsapp: {
      subject: null,
      body: "नमस्ते {{company}} टीम, यह Bulkskart की ओर से संदेश है, जो भारत का B2B थोक-व्यापार मार्केटप्लेस है। हमें पता है कि आप {{state}} में {{category}} बनाते हैं। थोक व्यापार के अवसरों के लिए https://bulkskart.com पर पंजीकरण का आमंत्रण है। आगे संदेश न चाहें तो STOP लिखकर उत्तर दें।",
    },
    call_script: {
      subject: null,
      body: [
        "शुरुआत: नमस्ते, क्या {{company}} के बिक्री प्रभारी से बात हो सकती है? यह [आपका नाम] की ओर से Bulkskart से कॉल है।",
        "उद्देश्य: हम {{state}} में {{category}} निर्माताओं के साथ काम करते हैं और Bulkskart पर पंजीकरण का आमंत्रण देना चाहते हैं।",
        "प्रश्न: क्या आप संदेश या ईमेल से पंजीकरण लिंक प्राप्त करना चाहेंगे?",
        "यदि रुचि नहीं: धन्यवाद। हम दोबारा संपर्क नहीं करेंगे। (अस्वीकृति दर्ज करें।)",
        "बिक्री, ऑर्डर या राजस्व का कोई वादा न करें।",
      ].join("\n"),
    },
  },
  te: {
    email: {
      subject: "{{state}}లో {{category}} తయారీదారులకు బల్క్ వ్యాపార అవకాశాలు",
      body: [
        "గౌరవనీయులైన {{company}} బృందానికి,",
        "",
        "Bulkskart అనేది భారతదేశవ్యాప్తంగా తయారీదారులను హోల్‌సేల్ వ్యాపారులు, పంపిణీదారులు మరియు బల్క్ కొనుగోలుదారులతో కలిపే B2B బల్క్-ట్రేడ్ మార్కెట్‌ప్లేస్.",
        "",
        "{{state}}లో {{category}} తయారీదారుగా {{company}} జాబితాలో ఉన్నట్లు మేము గమనించాము. బల్క్ వ్యాపార అవకాశాలను అన్వేషించడానికి Bulkskart లో నమోదు కావాలని ఆహ్వానిస్తున్నాము. అమ్మకాలు లేదా లీడ్స్ గురించి మేము ఎలాంటి హామీ ఇవ్వడం లేదు.",
        "",
        "మరింత సమాచారం కావాలంటే ఈ ఇమెయిల్‌కు సమాధానం ఇవ్వండి. ఇకపై సందేశాలు వద్దనుకుంటే 'unsubscribe' అని సమాధానం ఇవ్వండి; తర్వాత మేము సంప్రదించము.",
        "",
        "ధన్యవాదాలు,",
        "Bulkskart బృందం",
        "https://bulkskart.com",
      ].join("\n"),
    },
    whatsapp: {
      subject: null,
      body: "నమస్కారం {{company}} బృందం, ఇది భారతదేశపు B2B బల్క్-ట్రేడ్ మార్కెట్‌ప్లేస్ Bulkskart నుండి. {{state}}లో మీరు {{category}} తయారు చేస్తున్నారని మాకు తెలుసు. బల్క్ వ్యాపార అవకాశాల కోసం https://bulkskart.com లో నమోదు కావాలని ఆహ్వానిస్తున్నాము. ఇకపై సందేశాలు వద్దంటే STOP అని సమాధానం ఇవ్వండి.",
    },
    call_script: {
      subject: null,
      body: [
        "ప్రారంభం: నమస్కారం, {{company}} సేల్స్ బాధ్యులతో మాట్లాడవచ్చా? నేను Bulkskart నుండి మాట్లాడుతున్నాను.",
        "ఉద్దేశం: {{state}}లో {{category}} తయారీదారులతో మేము పని చేస్తున్నాము. Bulkskart లో నమోదు కావాలని ఆహ్వానించాలనుకుంటున్నాము.",
        "ప్రశ్న: సందేశం లేదా ఇమెయిల్ ద్వారా నమోదు లింక్ పంపమంటారా?",
        "ఆసక్తి లేకపోతే: ధన్యవాదాలు. ఇకపై మేము సంప్రదించము. (నిరాకరణను నమోదు చేయండి.)",
        "అమ్మకాలు, ఆర్డర్లు లేదా ఆదాయం గురించి ఎలాంటి హామీ ఇవ్వకండి.",
      ].join("\n"),
    },
  },
  ml: {
    email: {
      subject: "{{state}}-ൽ {{category}} നിർമ്മാതാക്കൾക്കുള്ള ബൾക്ക് ബിസിനസ് അവസരങ്ങൾ",
      body: [
        "പ്രിയ {{company}} ടീം,",
        "",
        "ഇന്ത്യയിലുടനീളമുള്ള നിർമ്മാതാക്കളെ മൊത്തവ്യാപാരികൾ, വിതരണക്കാർ, ബൾക്ക് വാങ്ങുന്നവർ എന്നിവരുമായി ബന്ധിപ്പിക്കുന്ന B2B ബൾക്ക് ട്രേഡ് മാർക്കറ്റ്പ്ലേസാണ് Bulkskart.",
        "",
        "{{state}}-ൽ {{category}} നിർമ്മാതാവായി {{company}} പട്ടികയിലുണ്ടെന്ന് ഞങ്ങൾ ശ്രദ്ധിച്ചു. ബൾക്ക് ബിസിനസ് അവസരങ്ങൾ പരിശോധിക്കാൻ Bulkskart-ൽ രജിസ്റ്റർ ചെയ്യാൻ ഞങ്ങൾ ക്ഷണിക്കുന്നു. വിൽപ്പനയെക്കുറിച്ചോ ലീഡുകളെക്കുറിച്ചോ ഞങ്ങൾ ഉറപ്പുകൾ നൽകുന്നില്ല.",
        "",
        "കൂടുതൽ വിവരങ്ങൾക്ക് ഈ ഇമെയിലിന് മറുപടി നൽകുക. ഇനി സന്ദേശങ്ങൾ വേണ്ടെങ്കിൽ 'unsubscribe' എന്ന് മറുപടി നൽകുക; പിന്നീട് ഞങ്ങൾ ബന്ധപ്പെടില്ല.",
        "",
        "സ്നേഹപൂർവ്വം,",
        "Bulkskart ടീം",
        "https://bulkskart.com",
      ].join("\n"),
    },
    whatsapp: {
      subject: null,
      body: "നമസ്കാരം {{company}} ടീം, ഇന്ത്യയിലെ B2B ബൾക്ക് ട്രേഡ് മാർക്കറ്റ്പ്ലേസ് Bulkskart-ൽ നിന്നാണ്. {{state}}-ൽ {{category}} നിർമ്മിക്കുന്നത് ഞങ്ങൾ ശ്രദ്ധിച്ചു. ബൾക്ക് ബിസിനസ് അവസരങ്ങൾക്കായി https://bulkskart.com-ൽ രജിസ്റ്റർ ചെയ്യാൻ ക്ഷണിക്കുന്നു. ഇനി സന്ദേശങ്ങൾ വേണ്ടെങ്കിൽ STOP എന്ന് മറുപടി നൽകുക.",
    },
    call_script: {
      subject: null,
      body: [
        "തുടക്കം: നമസ്കാരം, {{company}}-ലെ സെയിൽസ് ചുമതലക്കാരനോട് സംസാരിക്കാമോ? Bulkskart-ൽ നിന്നാണ് വിളിക്കുന്നത്.",
        "ഉദ്ദേശ്യം: {{state}}-ലെ {{category}} നിർമ്മാതാക്കളുമായി ഞങ്ങൾ പ്രവർത്തിക്കുന്നു. Bulkskart-ൽ രജിസ്റ്റർ ചെയ്യാൻ ക്ഷണിക്കാനാണ് വിളിക്കുന്നത്.",
        "ചോദ്യം: സന്ദേശമോ ഇമെയിലോ വഴി രജിസ്ട്രേഷൻ ലിങ്ക് ലഭിക്കാൻ താൽപ്പര്യമുണ്ടോ?",
        "താൽപ്പര്യമില്ലെങ്കിൽ: നന്ദി. ഇനി ബന്ധപ്പെടില്ല. (ഒഴിവാക്കൽ രേഖപ്പെടുത്തുക.)",
        "വിൽപ്പന, ഓർഡർ, വരുമാനം എന്നിവയെക്കുറിച്ച് ഉറപ്പുകൾ നൽകരുത്.",
      ].join("\n"),
    },
  },
};

function fill(template: string, values: { company: string; category: string; state: string }): string {
  return template
    .replaceAll("{{company}}", values.company)
    .replaceAll("{{category}}", values.category)
    .replaceAll("{{state}}", values.state);
}

export function renderTemplate(
  language: OutreachLanguage,
  channel: OutreachChannel,
  values: { company: string; category: string; state: string },
): { subject: string | null; body: string } {
  const template = TEMPLATES[language][channel];
  return {
    subject: template.subject ? fill(template.subject, values) : null,
    body: fill(template.body, values),
  };
}
