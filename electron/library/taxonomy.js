// Fixed, classic library taxonomy — identical for every user.
//
// Every entry in TAXONOMY *is* a department of the reading room. The list is the
// canonical department set and its order is the canonical department order (the 3D
// room order must not depend on how many books somebody owns).
//
// Each entry carries:
//   id       stable identifier — persisted on books as `departmentId`
//   de / en  display names (German is the name shown in the world, `Department.name`)
//   aliases  folder-name fragments that map onto this department (folder names in an automatic
//            books folder, a department name typed in the book info)
//   keywords keywords for automatic shelving (matched against title/subjects/description/
//            text — see classify.js). Keywords are stored UNPADDED; the word-boundary
//            logic lives in classify.js. Never add keywords shorter than 4 characters:
//            they produce substring misfires ("The Art of War" → Kunst).
//   shelves  [name, keywords[]] — the "Regale" inside the department.

const T = (id, de, en, aliases, keywords, shelves = []) => ({ id, de, en, aliases, keywords, shelves });

const TAXONOMY = [
  // ---------------------------------------------------------------- Belletristik --
  T('fiction', 'Romane & Erzählungen', 'Fiction & Novels',
    ['roman', 'romane', 'belletristik', 'fiction', 'novel', 'novels', 'erzählung', 'erzählungen', 'literatur', 'literature', 'prosa'],
    ['roman', 'novel', 'erzählung', 'erzählungen', 'short story', 'short stories', 'kurzgeschichte', 'kurzgeschichten', 'fiction', 'belletristik', 'liebesroman', 'familienroman', 'entwicklungsroman', 'gesellschaftsroman', 'historischer roman', 'novelle', 'saga', 'trilogie', 'trilogy', 'bestseller', 'literaturpreis', 'booker prize', 'erzähler', 'protagonist', 'liebesgeschichte', 'love story', 'dickens', 'tolstoi', 'tolstoy', 'dostojewski', 'dostoevsky', 'jane austen', 'brontë', 'flaubert', 'balzac', 'proust', 'hemingway', 'steinbeck', 'faulkner', 'fitzgerald', 'murakami', 'ishiguro', 'atwood', 'franzen', 'ferrante', 'erpenbeck', 'juli zeh'],
    [['Deutschsprachige Literatur', ['deutsch', 'german', 'österreich', 'schweiz', 'grass', 'böll', 'lenz', 'walser', 'erpenbeck']],
     ['Weltliteratur', ['weltliteratur', 'world literature', 'übersetzung', 'translated', 'russisch', 'französisch', 'englisch', 'amerikan', 'japanisch']],
     ['Gegenwartsromane', ['gegenwart', 'contemporary', 'modern', 'debüt', 'debut']],
     ['Historische Romane', ['historisch', 'historical', 'mittelalter', 'jahrhundert', 'saga']],
     ['Liebesromane', ['liebe', 'love', 'romance', 'herz', 'heart']],
     ['Erzählungen & Kurzgeschichten', ['erzählung', 'kurzgeschichte', 'short story', 'short stories', 'novelle', 'geschichten']]]),

  T('crime', 'Krimi & Thriller', 'Crime & Thriller',
    ['krimi', 'krimis', 'kriminalroman', 'thriller', 'crime', 'mystery', 'spannung'],
    ['krimi', 'kriminalroman', 'kriminalfall', 'crime novel', 'thriller', 'mord', 'mörder', 'murder', 'detektiv', 'detective', 'kommissar', 'inspector', 'ermittl', 'investigation', 'mystery', 'spannung', 'suspense', 'spionage', 'geheimagent', 'serienmörder', 'serial killer', 'polizei', 'police', 'tatort', 'crime scene', 'verbrechen', 'gerichtsmedizin', 'forensik', 'forensic', 'hardboiled', 'true crime', 'agatha christie', 'conan doyle', 'sherlock', 'holmes', 'simenon', 'maigret', 'nesbø', 'mankell', 'stieg larsson', 'läckberg', 'jack reacher', 'grisham', 'le carré', 'fitzek', 'connelly', 'highsmith', 'gerichtsthriller', 'psychothriller'],
    [['Klassiker des Krimis', ['christie', 'doyle', 'sherlock', 'simenon', 'maigret', 'klassiker', 'classic', 'golden age']],
     ['Skandinavien-Krimis', ['schwed', 'norweg', 'dänisch', 'island', 'nordic', 'skandinav', 'nesbø', 'mankell', 'larsson', 'läckberg']],
     ['Regionalkrimis', ['regional', 'bayern', 'eifel', 'allgäu', 'ostsee', 'nordsee', 'provence']],
     ['Psychothriller', ['psychothriller', 'psycho', 'obsession', 'wahn']],
     ['Spionage & Politthriller', ['spion', 'spionage', 'agent', 'geheimdienst', 'le carré', 'politthriller', 'verschwörung']],
     ['True Crime', ['true crime', 'wahre', 'real case', 'fallakte', 'kriminalfall']]]),

  T('fantasy', 'Fantasy & Science-Fiction', 'Fantasy & Science Fiction',
    ['fantasy', 'science fiction', 'science-fiction', 'scifi', 'sci-fi', 'phantastik', 'utopie', 'dystopie'],
    ['fantasy', 'science fiction', 'science-fiction', 'sci-fi', 'scifi', 'dystop', 'utopie', 'utopia', 'magie', 'magic', 'zauberer', 'wizard', 'hexen', 'drache', 'dragon', 'elfen', 'zwerge', 'raumschiff', 'spaceship', 'weltraum', 'galaxis', 'galaxy', 'außerirdisch', 'alien', 'roboter', 'robot', 'androide', 'cyberpunk', 'steampunk', 'zeitreise', 'time travel', 'parallelwelt', 'multiversum', 'vampir', 'vampire', 'werwolf', 'werewolf', 'zombie', 'apokalypse', 'sanderson', 'pratchett', 'scheibenwelt', 'discworld', 'le guin', 'asimov', 'frank herbert', 'philip k. dick', 'liu cixin', 'star wars', 'star trek', 'perry rhodan', 'königreich', 'kingdom', 'prophezeiung', 'prophecy', 'magier'],
    [['High Fantasy', ['high fantasy', 'epic', 'epos', 'königreich', 'kingdom', 'schwert', 'drache']],
     ['Urban Fantasy & Phantastik', ['urban fantasy', 'gegenwart', 'vampir', 'werwolf', 'magisch', 'phantastisch']],
     ['Science-Fiction', ['science fiction', 'sci-fi', 'raumschiff', 'weltraum', 'alien', 'asimov', 'dune', 'star trek']],
     ['Dystopien & Utopien', ['dystop', 'utopie', 'utopia', 'orwell', 'huxley', 'überwachungsstaat', 'zukunft']],
     ['Horror & Unheimliches', ['horror', 'grusel', 'unheimlich', 'lovecraft', 'stephen king', 'zombie', 'geist', 'ghost']]]),

  T('poetry', 'Lyrik, Drama & Klassiker', 'Poetry, Drama & Classics',
    ['lyrik', 'gedichte', 'poesie', 'poetry', 'drama', 'dramen', 'theaterstücke', 'klassiker', 'classics', 'gesammelte werke'],
    ['lyrik', 'gedicht', 'gedichte', 'poesie', 'poetry', 'poems', 'sonett', 'sonnet', 'ballade', 'versepos', 'strophe', 'anthologie', 'drama', 'dramen', 'tragödie', 'tragedy', 'komödie', 'comedy', 'theaterstück', 'schauspiel', 'bühne', 'klassiker der weltliteratur', 'gesammelte werke', 'collected works', 'sämtliche werke', 'werkausgabe', 'reclam', 'shakespeare', 'goethe', 'faust', 'schiller', 'lessing', 'kleist', 'büchner', 'hölderlin', 'rilke', 'heinrich heine', 'brecht', 'celan', 'bachmann', 'gottfried benn', 'trakl', 'novalis', 'eichendorff', 'fontane', 'kafka', 'thomas mann', 'hermann hesse', 'homer', 'ilias', 'odyssee', 'vergil', 'ovid', 'dante', 'molière', 'tschechow', 'ibsen', 'sophokles', 'euripides', 'antigone'],
    [['Lyrik & Gedichte', ['lyrik', 'gedicht', 'poesie', 'poetry', 'poems', 'sonett', 'ballade', 'anthologie']],
     ['Drama & Theater', ['drama', 'tragödie', 'komödie', 'theater', 'schauspiel', 'bühne', 'shakespeare', 'ibsen', 'brecht']],
     ['Antike & Epen', ['antike', 'homer', 'ilias', 'odyssee', 'vergil', 'ovid', 'sophokles', 'euripides', 'epos']],
     ['Deutsche Klassik & Romantik', ['goethe', 'schiller', 'lessing', 'kleist', 'hölderlin', 'novalis', 'eichendorff', 'romantik', 'klassik']],
     ['Moderne Klassiker', ['kafka', 'thomas mann', 'hesse', 'rilke', 'brecht', 'celan', 'modern classic']]]),

  // ------------------------------------------------------------------- Sachbuch --
  T('history', 'Geschichte', 'History',
    ['geschichte', 'history', 'historisch', 'historical', 'zeitgeschichte', 'militärgeschichte', 'kriegsführung', 'militär', 'warfare', 'military'],
    ['geschichte', 'history', 'historisch', 'historical', 'jahrhundert', 'century', 'mittelalter', 'medieval', 'antike', 'ancient', 'römisch', 'roman empire', 'griechisch', 'greek', 'ägypten', 'egypt', 'weltkrieg', 'world war', 'revolution', 'kaiser', 'emperor', 'könig', 'dynastie', 'dynasty', 'renaissance', 'reformation', 'aufklärung', 'enlightenment', 'kolonial', 'colonial', 'nationalsozial', 'drittes reich', 'holocaust', 'hitler', 'stalin', 'napoleon', 'bismarck', 'preußen', 'prussia', 'weimarer republik', 'kalter krieg', 'cold war', 'mauerfall', 'wiedervereinigung', 'chronik', 'chronicle', 'archäolog', 'archaeolog', 'zivilisation', 'civilization', 'menschheitsgeschichte', 'humankind', 'urkunde', 'epoche',
      // war and the military
      'krieg', 'warfare', 'militär', 'military', 'armee', 'army', 'soldat', 'soldier', 'clausewitz', 'sun tzu', 'kunst des krieges', 'art of war', 'guerilla', 'guerrilla', 'aufstand', 'insurgency', 'schlacht', 'battle', 'feldzug', 'campaign', 'general', 'wehrmacht', 'bundeswehr', 'partisan', 'söldner', 'mercenary', 'festung', 'belagerung', 'luftwaffe', 'panzer', 'atombombe', 'nuklear', 'abschreckung', 'deterrence', 'kriegsverbrechen', 'veteran'],
    [['Antike', ['antike', 'ancient', 'römisch', 'rome', 'griech', 'greek', 'ägypt', 'egypt', 'mesopotam', 'pharao', 'caesar', 'alexander']],
     ['Mittelalter', ['mittelalter', 'medieval', 'ritter', 'knight', 'kreuzzug', 'crusade', 'kloster', 'burg', 'karl der große']],
     ['Neuzeit & Aufklärung', ['neuzeit', 'renaissance', 'reformation', 'aufklärung', 'enlightenment', 'absolutismus', 'napoleon', 'französische revolution']],
     ['19. & 20. Jahrhundert', ['19. jahrhundert', '20. jahrhundert', 'industrialis', 'kaiserreich', 'bismarck', 'weimar', 'kalter krieg', 'cold war']],
     ['Weltkriege & Nationalsozialismus', ['weltkrieg', 'world war', 'nationalsozial', 'drittes reich', 'hitler', 'holocaust', 'widerstand', 'stalingrad']],
     ['Militärgeschichte & Strategie', ['militär', 'military', 'schlacht', 'battle', 'strategie', 'clausewitz', 'sun tzu', 'armee', 'feldzug', 'krieg']],
     ['Deutsche Geschichte', ['deutsch', 'german', 'preußen', 'prussia', 'wiedervereinigung', 'bundesrepublik']],
     ['Weltgeschichte & Kulturen', ['weltgeschichte', 'world history', 'zivilisation', 'civilization', 'menschheit', 'china', 'indien', 'afrika', 'amerika']]]),

  T('society', 'Politik & Gesellschaft', 'Politics & Society',
    ['politik', 'politics', 'gesellschaft', 'society', 'soziologie', 'geopolitik', 'geopolitics', 'diplomatie', 'diplomacy', 'propaganda', 'medien', 'media', 'recht'],
    ['politik', 'politics', 'political', 'gesellschaft', 'society', 'soziolog', 'sociolog', 'demokratie', 'democracy', 'parlament', 'wahlkampf', 'election', 'partei', 'regierung', 'government', 'verfassung', 'constitution', 'grundgesetz', 'staat', 'bürger', 'citizen', 'freiheit', 'freedom', 'gerechtigkeit', 'justice', 'ungleichheit', 'inequality', 'migration', 'integration', 'feminismus', 'feminism', 'rassismus', 'racism', 'klimapolitik', 'sozialstaat', 'zivilgesellschaft', 'protest', 'aktivismus', 'menschenrechte', 'human rights', 'völkerrecht', 'international law', 'rechtsstaat', 'kapitalismuskritik',
      // international politics
      'geopolit', 'weltordnung', 'world order', 'außenpolitik', 'foreign policy', 'sicherheitspolitik', 'international relations', 'internationale beziehungen', 'hegemon', 'imperium', 'empire', 'kissinger', 'brzezinski', 'mearsheimer', 'weltpolitik', 'multipolar', 'seidenstraße', 'silk road', 'nahost', 'middle east', 'ukraine', 'taiwan', 'russland', 'russia', 'europäische union', 'european union',
      // diplomacy
      'diplomat', 'diplomacy', 'vereinte nationen', 'united nations', 'botschaft', 'embassy', 'friedensvertrag', 'staatskunst', 'statecraft', 'metternich', 'talleyrand', 'wiener kongress',
      // media and public opinion
      'propaganda', 'desinformation', 'disinformation', 'fake news', 'medien', 'media', 'presse', 'journalis', 'öffentliche meinung', 'public opinion', 'bernays', 'chomsky', 'lippmann', 'narrativ', 'framing', 'zensur', 'censorship', 'populismus', 'populism', 'demagog', 'verschwörungstheorie', 'conspiracy', 'meinungsfreiheit', 'social media'],
    [['Politische Theorie', ['theorie', 'theory', 'ideologie', 'liberalis', 'konservativ', 'sozialis', 'anarch', 'marx', 'rawls', 'hobbes', 'rousseau']],
     ['Demokratie & Staat', ['demokratie', 'democracy', 'staat', 'verfassung', 'grundgesetz', 'parlament', 'wahl', 'partei', 'rechtsstaat']],
     ['Internationale Politik & Geopolitik', ['geopolit', 'international', 'außenpolitik', 'weltordnung', 'diplomat', 'china', 'russland', 'europa']],
     ['Gesellschaft & Soziologie', ['soziolog', 'gesellschaft', 'milieu', 'klasse', 'ungleichheit', 'migration', 'stadt', 'arbeit']],
     ['Medien & Öffentlichkeit', ['medien', 'media', 'journalis', 'propaganda', 'öffentlichkeit', 'meinung', 'social media', 'desinformation']],
     ['Recht & Menschenrechte', ['recht', 'gesetz', 'justiz', 'menschenrechte', 'völkerrecht', 'verfassung', 'gericht']],
     ['Zeitkritik & Essays', ['essay', 'streitschrift', 'kritik', 'plädoyer', 'debatte', 'zeitkritik']]]),

  T('philosophy', 'Philosophie & Religion', 'Philosophy & Religion',
    ['philosophie', 'philosophy', 'religion', 'theologie', 'theology', 'ethik', 'ethics', 'spiritualität', 'glaube'],
    ['philosoph', 'philosophy', 'ethik', 'ethics', 'moral', 'religion', 'theolog', 'glaube', 'faith', 'bibel', 'bible', 'koran', 'quran', 'talmud', 'buddhis', 'hinduis', 'islam', 'christentum', 'christianity', 'kirche', 'church', 'meditation', 'stoa', 'stoizis', 'stoic', 'seneca', 'marc aurel', 'marcus aurelius', 'epiktet', 'epictetus', 'platon', 'plato', 'sokrates', 'aristotel', 'descartes', 'spinoza', 'leibniz', 'david hume', 'kant', 'hegel', 'schopenhauer', 'nietzsche', 'kierkegaard', 'heidegger', 'wittgenstein', 'sartre', 'camus', 'hannah arendt', 'adorno', 'habermas', 'foucault', 'existenz', 'existential', 'metaphysik', 'metaphysics', 'erkenntnistheorie', 'epistemolog', 'ontolog', 'logik', 'logic', 'sinn des lebens', 'meaning of life', 'weisheit', 'wisdom', 'mystik', 'mystic', 'konfuzius', 'confucius', 'taoismus', 'gebet', 'prayer', 'spirituell', 'transzendenz', 'vernunft', 'dasein', 'kritik der reinen', 'freier wille', 'erkenntnis', 'gedankenexperiment', 'dialektik', 'aphorismen'],
    [['Antike Philosophie', ['antik', 'platon', 'plato', 'sokrates', 'aristotel', 'stoa', 'stoic', 'seneca', 'epiktet', 'marc aurel', 'epikur']],
     ['Neuzeit & Aufklärung', ['descartes', 'spinoza', 'leibniz', 'hume', 'locke', 'kant', 'aufklärung', 'enlightenment', 'rationalis']],
     ['Moderne Philosophie', ['hegel', 'nietzsche', 'schopenhauer', 'kierkegaard', 'heidegger', 'wittgenstein', 'sartre', 'camus', 'arendt', 'adorno', 'foucault']],
     ['Ethik & Moral', ['ethik', 'ethics', 'moral', 'tugend', 'virtue', 'gerechtigkeit', 'verantwortung', 'bioethik']],
     ['Religionen & Theologie', ['religion', 'theolog', 'bibel', 'koran', 'kirche', 'christentum', 'islam', 'judentum', 'buddhis', 'hinduis']],
     ['Spiritualität & Meditation', ['spirituell', 'meditation', 'achtsamkeit', 'mindful', 'yoga', 'mystik', 'seele']],
     ['Lebensphilosophie', ['lebenskunst', 'sinn des lebens', 'weisheit', 'wisdom', 'glück', 'gelassenheit']]]),

  T('psychology', 'Psychologie & Lebenskunst', 'Psychology & Personal Growth',
    ['psychologie', 'psychology', 'lebenskunst', 'ratgeber', 'self-help', 'selbsthilfe', 'persönlichkeit', 'personal development', 'motivation', 'produktivität', 'taktiken'],
    ['psycholog', 'psychology', 'psychotherap', 'therapie', 'therapy', 'verhalten', 'behavio', 'emotion', 'trauma', 'resilienz', 'resilience', 'stress', 'burnout', 'angst', 'anxiety', 'depression', 'achtsamkeit', 'mindful', 'selbstbewusst', 'selbstwert', 'confidence', 'motivation', 'produktiv', 'productiv', 'gewohnheit', 'habit', 'zeitmanagement', 'time management', 'disziplin', 'discipline', 'erfolg', 'success', 'mindset', 'persönlichkeitsentwicklung', 'personal development', 'selbsthilfe', 'ratgeber', 'coaching', 'kommunikation', 'communication', 'beziehung', 'relationship', 'partnerschaft', 'erziehung', 'parenting', 'schlafen lernen', 'kognitiv', 'cognitive', 'denkfehler', 'thaler', 'entscheidung', 'decision making', 'intuition', 'narziss', 'bindung', 'attachment', 'sigmund freud', 'c. g. jung', 'verhaltenstherapie',
      // persuasion and negotiation
      'menschenkenntnis', 'körpersprache', 'body language', 'manipulation', 'überzeug', 'persuasion', 'verhandlung', 'negotiation', 'rhetorik', 'rhetoric', 'einfluss', 'influence', 'macht', 'power', 'machiavelli', 'strategem', 'stratagem', 'führung', 'leadership', 'teamarbeit', 'konflikt', 'mediation'],
    [['Psychologie & Gehirn', ['psycholog', 'gehirn', 'brain', 'kognitiv', 'cognitive', 'neuro', 'wahrnehmung', 'gedächtnis']],
     ['Therapie & Seelische Gesundheit', ['therapie', 'therapy', 'trauma', 'depression', 'angst', 'burnout', 'psychosomat', 'sucht']],
     ['Persönlichkeit & Selbsterkenntnis', ['persönlichkeit', 'selbstwert', 'selbsterkenntnis', 'identität', 'charakter', 'narziss', 'bindung']],
     ['Gewohnheiten & Produktivität', ['gewohnheit', 'habit', 'produktiv', 'zeitmanagement', 'disziplin', 'fokus']],
     ['Kommunikation & Menschenkenntnis', ['kommunikation', 'communication', 'rhetorik', 'körpersprache', 'verhandlung', 'überzeug', 'menschenkenntnis', 'konflikt']],
     ['Beziehung & Familie', ['beziehung', 'partnerschaft', 'liebe', 'familie', 'erziehung', 'parenting', 'kinder']],
     ['Führung & Arbeit', ['führung', 'leadership', 'management', 'team', 'karriere', 'career', 'arbeit']],
     ['Lebenskunst & Gelassenheit', ['lebenskunst', 'gelassenheit', 'glück', 'happiness', 'zufriedenheit', 'minimalis']]]),

  T('science', 'Wissenschaft & Natur', 'Science & Nature',
    ['wissenschaft', 'science', 'naturwissenschaft', 'natur', 'nature', 'physik', 'physics', 'biologie', 'biology', 'chemie', 'mathematik', 'mathematics', 'astronomie', 'medizin'],
    ['wissenschaft', 'science', 'physik', 'physics', 'chemie', 'chemistry', 'biolog', 'biology', 'mathematik', 'mathematics', 'geometrie', 'algebra', 'statistik', 'statistics', 'astronom', 'kosmos', 'cosmos', 'universum', 'universe', 'quanten', 'quantum', 'relativität', 'relativity', 'teilchen', 'particle', 'evolution', 'darwin', 'genetik', 'genom', 'zelle', 'neurowissenschaft', 'neuroscience', 'gehirn', 'brain', 'medizin', 'medicine', 'anatomie', 'anatomy', 'virus', 'bakterien', 'immunsystem', 'natur', 'nature', 'tiere', 'animal', 'pflanzen', 'plant', 'vögel', 'birds', 'insekten', 'insects', 'pilze', 'wald', 'forest', 'bäume', 'trees', 'ozean', 'ocean', 'klima', 'climate', 'klimawandel', 'umwelt', 'environment', 'ökolog', 'ecolog', 'nachhaltig', 'geolog', 'vulkan', 'planet', 'sterne', 'stars', 'schwarzes loch', 'black hole', 'urknall', 'big bang', 'einstein', 'hawking', 'feynman', 'dawkins', 'carl sagan', 'humboldt', 'wohlleben', 'attenborough', 'forschung', 'research', 'experiment', 'entdeckung', 'discovery', 'naturgeschichte'],
    [['Physik & Kosmos', ['physik', 'physics', 'quanten', 'relativität', 'astronom', 'kosmos', 'universum', 'planet', 'stern', 'urknall', 'einstein', 'hawking']],
     ['Mathematik & Logik', ['mathematik', 'mathematics', 'algebra', 'geometrie', 'statistik', 'zahlen', 'numbers', 'beweis', 'logik']],
     ['Biologie & Evolution', ['biolog', 'evolution', 'darwin', 'genetik', 'genom', 'zelle', 'organismus', 'mikro']],
     ['Medizin & Körper', ['medizin', 'medicine', 'anatomie', 'krankheit', 'immun', 'virus', 'chirurg', 'gehirn']],
     ['Natur & Tiere', ['natur', 'nature', 'tier', 'animal', 'vogel', 'bird', 'insekt', 'wald', 'baum', 'pflanze', 'pilz', 'meer', 'ozean']],
     ['Klima & Umwelt', ['klima', 'climate', 'umwelt', 'environment', 'ökolog', 'nachhaltig', 'artensterben', 'energiewende']],
     ['Chemie & Erde', ['chemie', 'chemistry', 'geolog', 'mineral', 'vulkan', 'erde', 'gestein', 'element']],
     ['Wissenschaftsgeschichte', ['wissenschaftsgeschichte', 'entdeckung', 'forscher', 'nobelpreis', 'geschichte der']]]),

  T('technology', 'Technik & Informatik', 'Technology & Computing',
    ['technik', 'technology', 'informatik', 'computer science', 'programmierung', 'programming', 'computer', 'software', 'internetsicherheit', 'it-sicherheit', 'security', 'sicherheit', 'privatsphäre', 'privacy', 'osint', 'hacking'],
    ['programm', 'programmier', 'programming', 'software', 'quellcode', 'source code', 'coding', 'python', 'javascript', 'typescript', 'java', 'rust', 'golang', 'algorithmus', 'algorithm', 'datenstruktur', 'data structure', 'datenbank', 'database', 'postgres', 'computer', 'informatik', 'computer science', 'machine learning', 'maschinelles lernen', 'künstliche intelligenz', 'artificial intelligence', 'deep learning', 'neuronale netze', 'neural network', 'data science', 'cloud', 'devops', 'docker', 'kubernetes', 'webentwicklung', 'html', 'react', 'node.js', 'backend', 'frontend', 'linux', 'unix', 'windows', 'server', 'hardware', 'elektronik', 'electronic', 'arduino', 'raspberry', 'ingenieur', 'engineering', 'technik', 'technology', 'maschinenbau', 'mechanik', 'robotik', 'robotics', 'automatisierung', 'digitalisierung', 'internet', 'design pattern', 'refactoring', 'compiler', 'betriebssystem', 'shell-skript', 'tabellenkalkulation', 'excel',
      // security and privacy
      'privatsphäre', 'privacy', 'datenschutz', 'osint', 'opsec', 'hacker', 'hacking', 'cybersecurity', 'cyber', 'it-sicherheit', 'anonymität', 'anonymous', 'verschlüsselung', 'encryption', 'kryptograf', 'cryptograph', 'passwort', 'password', 'malware', 'phishing', 'exploit', 'penetration test', 'pentest', 'firewall', 'überwachung', 'surveillance', 'darknet', 'tracking', 'social engineering', 'schwachstelle', 'snowden'],
    [['Programmierung', ['programmier', 'programming', 'code', 'python', 'javascript', 'java', 'rust', 'entwickl']],
     ['Algorithmen & Informatik', ['algorithm', 'datenstruktur', 'informatik', 'computer science', 'komplexität', 'compiler']],
     ['Web & Datenbanken', ['web', 'html', 'react', 'node', 'datenbank', 'database', 'backend', 'frontend']],
     ['Künstliche Intelligenz & Daten', ['künstliche intelligenz', 'artificial intelligence', 'machine learning', 'deep learning', 'neuronale', 'data science']],
     ['Systeme, Linux & Netzwerke', ['linux', 'unix', 'server', 'netzwerk', 'network', 'betriebssystem', 'cloud', 'docker', 'devops']],
     ['IT-Sicherheit & Privatsphäre', ['sicherheit', 'security', 'privacy', 'datenschutz', 'verschlüsselung', 'hacking', 'osint', 'malware']],
     ['Technik & Elektronik', ['elektronik', 'hardware', 'arduino', 'raspberry', 'maschinenbau', 'ingenieur', 'robotik', 'mechanik']],
     ['Digitale Welt & Gesellschaft', ['digitalisierung', 'internet', 'plattform', 'silicon valley', 'netzpolitik']]]),

  T('business', 'Wirtschaft & Finanzen', 'Business & Finance',
    ['wirtschaft', 'economy', 'economics', 'finanzen', 'finance', 'börse', 'boerse', 'investing', 'geldanlage', 'aktien', 'business', 'volkswirtschaft', 'betriebswirtschaft', 'management'],
    ['aktien', 'stock market', 'stocks', 'börse', 'wall street', 'investieren', 'investing', 'investor', 'investment', 'anleger', 'geldanlage', 'index fund', 'dividende', 'dividend', 'portfolio', 'depot', 'rendite', 'zinsen', 'interest rate', 'anleihe', 'bond', 'fonds', 'vermögen', 'wealth', 'finanziell', 'financial', 'finanzen', 'finance', 'buffett', 'benjamin graham', 'kostolany', 'peter lynch', 'munger', 'bogle', 'ray dalio', 'value investing', 'fundamentalanalyse', 'technische analyse', 'technical analysis', 'trading', 'trader', 'optionen', 'derivate', 'derivatives', 'futures', 'hedgefonds', 'inflation', 'zentralbank', 'central bank', 'notenbank', 'finanzkrise', 'börsencrash', 'spekulation', 'immobilien', 'real estate', 'steuern', 'taxes', 'versicherung', 'insurance', 'altersvorsorge', 'rente', 'retirement', 'sparen', 'saving', 'schulden', 'debt', 'kredit', 'credit', 'bilanz', 'balance sheet', 'cashflow', 'unternehmensbewertung', 'valuation', 'volkswirtschaft', 'betriebswirtschaft', 'economics', 'ökonomie', 'kapitalismus', 'capitalism', 'markt', 'market', 'währung', 'currency', 'bitcoin', 'kryptowährung', 'cryptocurrency', 'geldsystem', 'monetary', 'unternehmen', 'company', 'startup', 'gründer', 'entrepreneur', 'marketing', 'vertrieb', 'controlling', 'logistik', 'globalisierung', 'arbeitsmarkt', 'wirtschaftsgeschichte', 'behavioral finance', 'reich werden', 'finanzielle freiheit'],
    [['Geldanlage & Börse', ['börse', 'aktien', 'stock', 'investieren', 'investing', 'anleger', 'depot', 'dividende', 'rendite']],
     ['Value Investing & Klassiker', ['value', 'graham', 'buffett', 'munger', 'lynch', 'klassiker']],
     ['ETFs & passives Investieren', ['index', 'passiv', 'bogle', 'buy and hold', 'weltportfolio', 'indexfonds']],
     ['Trading & Analyse', ['trading', 'trader', 'technische analyse', 'chart', 'daytrading', 'candlestick', 'indikator', 'optionen', 'derivat']],
     ['Persönliche Finanzen', ['persönlich', 'personal finance', 'sparen', 'budget', 'schulden', 'rente', 'altersvorsorge', 'finanzielle freiheit', 'vermögensaufbau', 'steuer', 'versicherung']],
     ['Volkswirtschaft & Geldsystem', ['volkswirtschaft', 'economics', 'ökonom', 'kapitalismus', 'geldsystem', 'zentralbank', 'inflation', 'globalis', 'währung']],
     ['Krisen & Wirtschaftsgeschichte', ['krise', 'crisis', 'crash', 'blase', 'bubble', 'depression', 'lehman', 'wirtschaftsgeschichte', 'hyperinflation']],
     ['Unternehmen & Management', ['unternehmen', 'company', 'management', 'startup', 'gründ', 'entrepreneur', 'marketing', 'strategie', 'controlling']],
     ['Immobilien & Steuern', ['immobilie', 'real estate', 'wohnung', 'vermieter', 'miete', 'steuer']]]),

  T('art', 'Kunst, Musik & Design', 'Art, Music & Design',
    ['kunst', 'kunstgeschichte', 'musik', 'music', 'design', 'architektur', 'architecture', 'fotografie', 'photography', 'gestaltung', 'bildband'],
    ['kunst', 'kunstgeschichte', 'künstler', 'artist', 'maler', 'painter', 'malerei', 'painting', 'gemälde', 'zeichnen', 'drawing', 'skizze', 'sketch', 'aquarell', 'watercolor', 'ölmalerei', 'impressionis', 'expressionis', 'surrealis', 'moderne kunst', 'modern art', 'bauhaus', 'architekt', 'architecture', 'gebäude', 'building', 'design', 'produktdesign', 'typografie', 'typography', 'grafikdesign', 'graphic design', 'illustration', 'fotograf', 'photograph', 'kamera', 'camera', 'bildband', 'museum', 'galerie', 'gallery', 'ausstellung', 'exhibition', 'skulptur', 'sculpture', 'keramik', 'musik', 'music', 'komponist', 'composer', 'klassische musik', 'klavier', 'piano', 'gitarre', 'guitar', 'orchester', 'sinfonie', 'symphony', 'jazz', 'blues', 'oper', 'opera', 'musiktheorie', 'harmonielehre', 'johann sebastian bach', 'mozart', 'beethoven', 'brahms', 'wagner', 'film', 'kino', 'cinema', 'regie', 'drehbuch', 'schauspieler', 'mode', 'fashion', 'möbel', 'furniture', 'innenarchitektur', 'interior', 'kalligraf', 'van gogh', 'monet', 'picasso', 'da vinci', 'leonardo', 'michelangelo', 'rembrandt', 'dürer', 'kandinsky', 'le corbusier', 'frank lloyd wright'],
    [['Kunstgeschichte', ['kunstgeschichte', 'epoche', 'renaissance', 'barock', 'impressionis', 'moderne', 'avantgarde']],
     ['Malerei & Zeichnen', ['malerei', 'painting', 'maler', 'zeichnen', 'drawing', 'aquarell', 'skizze', 'anleitung']],
     ['Fotografie', ['fotograf', 'photograph', 'kamera', 'bildband', 'belichtung', 'porträt', 'landschaft']],
     ['Architektur', ['architekt', 'architecture', 'bauen', 'gebäude', 'stadt', 'raum', 'bauhaus', 'le corbusier']],
     ['Design & Typografie', ['design', 'typograf', 'grafik', 'layout', 'produkt', 'möbel', 'interior', 'mode']],
     ['Musik', ['musik', 'music', 'komponist', 'klavier', 'gitarre', 'oper', 'jazz', 'orchester', 'noten', 'harmonielehre']],
     ['Film & Theater', ['film', 'kino', 'cinema', 'regie', 'drehbuch', 'schauspiel']],
     ['Ausstellungskataloge', ['katalog', 'ausstellung', 'exhibition', 'museum', 'sammlung', 'collection']]]),

  T('biography', 'Biografien & Erinnerungen', 'Biographies & Memoirs',
    ['biografie', 'biografien', 'biographie', 'biography', 'biographies', 'memoiren', 'memoir', 'autobiografie', 'erinnerungen', 'lebenserinnerungen'],
    ['biograf', 'biograph', 'biography', 'autobiograf', 'autobiograph', 'autobiography', 'memoir', 'memoiren', 'erinnerungen', 'lebensgeschichte', 'life story', 'mein leben', 'my life', 'tagebuch', 'diary', 'briefe', 'letters', 'porträt', 'portrait', 'lebenswerk', 'das leben des', 'gespräche mit', 'zeitzeuge', 'werdegang'],
    [['Politik & Zeitgeschichte', ['politik', 'kanzler', 'präsident', 'staatsmann', 'widerstand', 'zeitzeuge']],
     ['Kunst & Musik', ['maler', 'künstler', 'komponist', 'musiker', 'schriftsteller', 'dichter']],
     ['Wissenschaft & Technik', ['forscher', 'wissenschaftler', 'erfinder', 'physiker', 'ingenieur']],
     ['Wirtschaft & Unternehmer', ['unternehmer', 'gründer', 'manager', 'milliardär', 'konzern']],
     ['Sport & Abenteuer', ['sportler', 'bergsteiger', 'abenteurer', 'expedition', 'weltmeister']],
     ['Erinnerungen & Tagebücher', ['tagebuch', 'diary', 'erinnerungen', 'briefe', 'aufzeichnungen']]]),

  T('health', 'Gesundheit, Sport & Küche', 'Health, Sports & Cooking',
    ['gesundheit', 'health', 'sport', 'fitness', 'ernährung', 'nutrition', 'kochen', 'cooking', 'kochbuch', 'kochbücher', 'rezepte', 'küche', 'garten'],
    ['gesundheit', 'health', 'fitness', 'krafttraining', 'strength training', 'workout', 'muskel', 'muscle', 'laufen', 'running', 'marathon', 'yoga', 'pilates', 'ernährung', 'nutrition', 'diät', 'fasten', 'fasting', 'vegan', 'vegetarisch', 'vegetarian', 'kochen', 'cooking', 'rezept', 'recipe', 'kochbuch', 'cookbook', 'backen', 'baking', 'brot backen', 'küche', 'kitchen', 'grillen', 'barbecue', 'abnehmen', 'weight loss', 'stoffwechsel', 'immunsystem', 'vitamin', 'heilpflanzen', 'naturheil', 'hausmittel', 'rückenschmerz', 'physiotherap', 'prävention', 'wandern', 'hiking', 'radfahren', 'cycling', 'schwimmen', 'swimming', 'klettern', 'climbing', 'kampfsport', 'martial art', 'boxen', 'boxing', 'fußball', 'football', 'tennis', 'triathlon', 'trainingsplan',
      // garden and provisions
      'garten', 'gardening', 'gemüse', 'selbstversorg', 'einkochen', 'einmachen', 'fermentier', 'haltbar machen', 'vorratshaltung', 'erste hilfe', 'first aid', 'kräuter'],
    [['Ernährung & Diät', ['ernährung', 'nutrition', 'diät', 'fasten', 'abnehmen', 'vegan', 'vegetarisch', 'stoffwechsel']],
     ['Kochen & Backen', ['kochen', 'cooking', 'rezept', 'recipe', 'kochbuch', 'backen', 'baking', 'brot', 'küche', 'grillen']],
     ['Fitness & Krafttraining', ['fitness', 'krafttraining', 'workout', 'muskel', 'trainingsplan', 'hantel']],
     ['Laufen & Ausdauer', ['laufen', 'running', 'marathon', 'ausdauer', 'triathlon', 'radfahren', 'schwimmen']],
     ['Sportarten', ['fußball', 'tennis', 'klettern', 'kampfsport', 'boxen', 'basketball', 'golf']],
     ['Medizin & Vorsorge', ['medizin', 'krankheit', 'vorsorge', 'immun', 'hausmittel', 'naturheil', 'erste hilfe']],
     ['Yoga & Entspannung', ['yoga', 'pilates', 'entspannung', 'atemübung', 'meditation', 'massage']],
     ['Garten & Selbstversorgung', ['garten', 'gemüse', 'selbstversorg', 'einkochen', 'fermentier', 'kräuter', 'permakultur']]]),

  T('travel', 'Reisen & Länder', 'Travel & Places',
    ['reise', 'reisen', 'travel', 'reiseführer', 'länder', 'länderkunde', 'geografie', 'geographie', 'draußen', 'outdoor', 'wandern', 'survival', 'bushcraft', 'prepping'],
    ['reise', 'travel', 'reiseführer', 'travel guide', 'lonely planet', 'baedeker', 'marco polo', 'dumont', 'urlaub', 'vacation', 'reisebericht', 'reisetagebuch', 'städtereise', 'weltreise', 'expedition', 'abenteuer', 'adventure', 'entdecker', 'explorer', 'geografie', 'geographie', 'länderkunde', 'atlas', 'landkarte', 'italien', 'italy', 'frankreich', 'france', 'spanien', 'spain', 'portugal', 'griechenland', 'norwegen', 'norway', 'schweden', 'island', 'iceland', 'schottland', 'irland', 'japan', 'thailand', 'kanada', 'canada', 'australien', 'australia', 'neuseeland', 'patagonien', 'safari', 'alpen', 'toskana', 'provence',
      // outdoors
      'outdoor', 'wandern', 'hiking', 'fernwanderweg', 'jakobsweg', 'camping', 'zelten', 'roadtrip', 'wohnmobil', 'fahrradtour', 'bikepacking', 'bergsteigen', 'mountaineering', 'wildnis', 'wilderness', 'survival', 'bushcraft', 'überleben', 'orientierung', 'kompass', 'lagerfeuer', 'biwak', 'ausrüstung', 'krisenvorsorge', 'notvorrat', 'blackout', 'kanufahren', 'segeln', 'sailing'],
    [['Reiseführer', ['reiseführer', 'travel guide', 'lonely planet', 'baedeker', 'marco polo', 'dumont', 'guide']],
     ['Reiseberichte', ['reisebericht', 'reisetagebuch', 'unterwegs', 'abenteuer', 'expedition']],
     ['Europa', ['europa', 'italien', 'frankreich', 'spanien', 'portugal', 'griechenland', 'norwegen', 'schweden', 'island', 'schottland', 'alpen', 'toskana']],
     ['Welt & Ferne', ['asien', 'japan', 'china', 'indien', 'afrika', 'amerika', 'kanada', 'australien', 'patagonien', 'safari']],
     ['Wandern & Berge', ['wandern', 'hiking', 'bergsteigen', 'alpen', 'gipfel', 'fernwanderweg', 'jakobsweg']],
     ['Draußen & Survival', ['outdoor', 'camping', 'zelten', 'wildnis', 'survival', 'bushcraft', 'lagerfeuer', 'ausrüstung', 'krisenvorsorge']],
     ['Länder & Kulturen', ['länderkunde', 'kultur', 'geografie', 'atlas']]]),

  T('language', 'Sprache & Nachschlagewerke', 'Language & Reference',
    ['sprache', 'sprachen', 'language', 'languages', 'wörterbuch', 'wörterbücher', 'dictionary', 'grammatik', 'nachschlagewerk', 'nachschlagewerke', 'lexikon', 'lexika', 'reference', 'allgemeinwissen', 'allgemeinbildung', 'schreiben'],
    ['sprache', 'language', 'wörterbuch', 'dictionary', 'grammatik', 'grammar', 'vokabeln', 'vocabulary', 'englisch lernen', 'learn english', 'deutsch lernen', 'learn german', 'französisch', 'french', 'spanisch', 'spanish', 'italienisch', 'italian', 'latein', 'latin', 'altgriechisch', 'japanisch', 'japanese', 'chinesisch', 'chinese', 'russisch', 'russian', 'übersetzung', 'translation', 'sprachkurs', 'language course', 'rechtschreibung', 'spelling', 'duden', 'stilistik', 'schreiben lernen', 'creative writing', 'kreatives schreiben', 'linguistik', 'linguistics', 'etymolog', 'redewendung', 'idiom',
      // general knowledge and reference works
      'allgemeinwissen', 'allgemeinbildung', 'general knowledge', 'lexikon', 'enzyklopäd', 'encyclop', 'nachschlagewerk', 'reference', 'handbuch', 'handbook', 'kompendium', 'quizfragen', 'bildungskanon', 'was man wissen muss', 'jahrbuch'],
    [['Wörterbücher', ['wörterbuch', 'dictionary', 'duden', 'thesaurus', 'übersetzung']],
     ['Sprachkurse', ['sprachkurs', 'lernen', 'course', 'grundkurs', 'vokabeln', 'übungen']],
     ['Grammatik & Stil', ['grammatik', 'grammar', 'stil', 'style', 'rechtschreibung', 'zeichensetzung']],
     ['Schreiben', ['schreiben', 'writing', 'kreatives schreiben', 'creative writing', 'autoren']],
     ['Lexika & Nachschlagewerke', ['lexikon', 'enzyklopäd', 'encyclop', 'nachschlag', 'handbuch', 'atlas', 'jahrbuch']],
     ['Allgemeinwissen', ['allgemeinwissen', 'allgemeinbildung', 'general knowledge', 'fakten', 'quiz', 'bildungskanon']],
     ['Linguistik', ['linguistik', 'linguistics', 'etymolog', 'sprachwissenschaft', 'phonet']]]),

  T('kids', 'Kinder & Jugend', 'Children & Young Adults',
    ['kinder', 'kinderbuch', 'kinderbücher', 'jugend', 'jugendbuch', 'jugendbücher', 'children', 'kids', 'young adult'],
    ['kinderbuch', 'kinderbücher', 'children', 'bilderbuch', 'picture book', 'vorlesebuch', 'vorlesen', 'gute nacht geschichte', 'bedtime', 'märchen', 'fairy tale', 'gebrüder grimm', 'andersen', 'jugendbuch', 'young adult', 'jugendroman', 'erstleser', 'leseanfänger', 'kindergarten', 'grundschule', 'astrid lindgren', 'ab 6 jahren', 'ab 8 jahren', 'ab 10 jahren', 'ab 12 jahren', 'für kinder', 'for kids'],
    [['Bilderbücher', ['bilderbuch', 'picture book', 'vorlesen', 'pappbilderbuch']],
     ['Erstlesebücher', ['erstleser', 'leseanfänger', 'erste klasse', 'lesenlernen']],
     ['Kinderromane', ['kinderroman', 'abenteuer', 'bande', 'freunde']],
     ['Jugendbücher', ['jugendbuch', 'jugendroman', 'young adult', 'teenager']],
     ['Märchen & Klassiker', ['märchen', 'fairy tale', 'grimm', 'andersen', 'klassiker', 'lindgren', 'sagen']],
     ['Wissen für Kinder', ['wissen', 'entdecken', 'experimente']]]),

  T('comics', 'Comics & Graphic Novels', 'Comics & Graphic Novels',
    ['comic', 'comics', 'manga', 'mangas', 'graphic novel', 'graphic novels'],
    ['comic', 'comics', 'manga', 'graphic novel', 'comicband', 'asterix', 'tintin', 'tim und struppi', 'lucky luke', 'spirou', 'donald duck', 'micky maus', 'batman', 'superman', 'marvel', 'spider-man', 'x-men', 'watchmen', 'sandman', 'one piece', 'naruto', 'dragon ball', 'attack on titan', 'anime', 'cartoon', 'comicstrip', 'peanuts', 'calvin and hobbes', 'persepolis'],
    [['Graphic Novels', ['graphic novel', 'literarisch', 'persepolis', 'sandman', 'watchmen']],
     ['Franko-belgische Comics', ['asterix', 'tintin', 'tim und struppi', 'lucky luke', 'spirou', 'gaston']],
     ['Superhelden', ['superheld', 'superhero', 'batman', 'superman', 'marvel', 'spider-man', 'x-men', 'avengers']],
     ['Manga', ['manga', 'one piece', 'naruto', 'dragon ball', 'anime', 'shonen']],
     ['Funnys & Strips', ['strip', 'peanuts', 'calvin', 'garfield', 'cartoon', 'humor', 'donald', 'micky']]]),

  T('games', 'Spiele & Schach', 'Games & Chess',
    ['spiele', 'spiel', 'games', 'schach', 'chess', 'brettspiel', 'brettspiele', 'kartenspiel', 'poker', 'glücksspiel', 'gambling', 'rätsel', 'ajedrez', 'échecs'],
    ['schach', 'chess', 'schachbuch', 'eröffnung', 'chess opening', 'endspiel', 'endgame', 'mittelspiel', 'middlegame', 'gambit', 'sizilianisch', 'sicilian', 'grünfeld', 'nimzo', 'caro-kann', 'königsindisch', 'french defence', 'damengambit', 'ruy lopez', 'schachpartie', 'partien', 'grandmaster', 'großmeister', 'schachweltmeister', 'schachtaktik', 'bauernstruktur', 'pawn structure', 'zugzwang', 'schachmatt', 'checkmate', 'rochade', 'kasparow', 'kasparov', 'karpow', 'karpov', 'capablanca', 'magnus carlsen', 'tarrasch', 'nimzowitsch', 'lasker', 'aljechin', 'alekhine', 'botwinnik', 'botvinnik', 'kramnik', 'dvoretsky', 'silman', 'chessbase', 'lichess', 'schachverein', 'schachtraining',
      // card games and gambling
      'poker', "hold'em", 'holdem', 'texas hold', 'pot odds', 'bluff', 'casino', 'blackjack', 'roulette', 'glücksspiel', 'gambling', 'sklansky', 'harrington', 'negreanu', 'cash game', 'spieltheorie', 'game theory', 'kartenspiel', 'doppelkopf',
      // general games
      'brettspiel', 'board game', 'gesellschaftsspiel', 'würfelspiel', 'rollenspiel', 'pen and paper', 'dungeons', 'videospiel', 'video game', 'computerspiel', 'game design', 'rätsel', 'puzzle', 'kreuzworträtsel', 'sudoku', 'denksport', 'zaubertricks', 'billard', 'backgammon'],
    [['Schach · Einstieg & Grundlagen', ['einstieg', 'grundlagen', 'beginner', 'anfänger', 'fundamentals', 'basics', 'lernen', 'for dummies']],
     ['Schach · Taktik & Kombinationen', ['taktik', 'tactic', 'kombination', 'combination', 'puzzle', 'aufgaben', 'opfer', 'sacrifice', 'matt in', 'mate in']],
     ['Schach · Strategie & Positionsspiel', ['strategie', 'strategy', 'position', 'bauernstruktur', 'pawn structure', 'prophylaxe']],
     ['Schach · Eröffnungen', ['eröffnung', 'opening', 'repertoire', 'gambit', 'sizilian', 'sicilian', 'caro', 'ruy lopez', 'königsindisch', 'nimzo', 'grünfeld', 'damengambit', 'london system', 'katalanisch', 'slawisch', 'benoni']],
     ['Schach · Mittel- & Endspiel', ['mittelspiel', 'middlegame', 'endspiel', 'endgame', 'turmendspiel', 'bauernendspiel', 'endings']],
     ['Schach · Partien & Weltmeister', ['partien', 'games', 'weltmeister', 'world champion', 'best games', 'kasparov', 'karpov', 'fischer', 'capablanca', 'carlsen', 'botvinnik', 'lasker', 'alekhine', 'kramnik', 'anand', 'spassky', 'petrosian', 'morphy']],
     ['Schach · Training', ['training', 'übungen', 'exercises', 'workbook', 'kurs', 'course', 'spielstärke', 'improve', 'verbessern']],
     ['Karten- & Glücksspiele', ['poker', 'holdem', "hold'em", 'casino', 'blackjack', 'roulette', 'skat', 'bridge', 'kartenspiel', 'glücksspiel']],
     ['Brett- & Gesellschaftsspiele', ['brettspiel', 'board game', 'gesellschaftsspiel', 'würfel', 'rollenspiel', 'dungeons', 'spielregeln', 'backgammon']],
     ['Rätsel & Denksport', ['rätsel', 'puzzle', 'kreuzwort', 'sudoku', 'denksport', 'knobel']],
     ['Videospiele', ['videospiel', 'computerspiel', 'video game', 'game design', 'konsole', 'gaming']]]),

  T('misc', 'Verschiedenes', 'Miscellaneous',
    ['verschiedenes', 'sonstiges', 'misc', 'miscellaneous', 'other', 'diverse', 'unsortiert', 'neuzugänge'], [], []),
];

// --- canonical department set -------------------------------------------------------
const DEPARTMENTS = TAXONOMY.map((t, i) => ({ id: t.id, de: t.de, en: t.en, order: i }));
const DEPARTMENT_BY_ID = new Map(DEPARTMENTS.map((d) => [d.id, d]));
const TAXONOMY_BY_ID = new Map(TAXONOMY.map((t) => [t.id, t]));
const DEFAULT_DEPARTMENT = 'misc';

/**
 * German display names of departments in earlier versions → current department id (library.json migration;
 * normalized: lowercase, collapsed whitespace). A book whose old department is not listed here is shelved again
 * (library.js migrate).
 */
const LEGACY_DEPARTMENTS = {
  'ratgeber & persönlichkeit': 'psychology',
  'technik & programmierung': 'technology',
  'kunst, architektur & design': 'art',
  'biografien': 'biography',
  'gesundheit, sport & ernährung': 'health',
  'sprachen & wörterbücher': 'language',
  'neuzugänge': 'misc',
  'sonstiges': 'misc',
  'allgemein': 'misc',
};

const normalizeName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Department record for an id (or null). */
function departmentById(id) { return DEPARTMENT_BY_ID.get(id) || null; }
/** Taxonomy entry for a department id (or null). */
function taxonomyById(id) { return TAXONOMY_BY_ID.get(id) || null; }
/** Position in the canonical order; unknown ids sort last. */
function departmentOrder(id) { const d = DEPARTMENT_BY_ID.get(id); return d ? d.order : DEPARTMENTS.length; }
/** Map a legacy department id or display name onto a current department id (or null). */
function legacyDepartmentId(nameOrId) {
  if (!nameOrId) return null;
  const raw = String(nameOrId);
  if (DEPARTMENT_BY_ID.has(raw)) return raw;
  const n = normalizeName(raw);
  for (const d of DEPARTMENTS) if (normalizeName(d.de) === n || normalizeName(d.en) === n) return d.id;
  if (LEGACY_DEPARTMENTS[n]) return LEGACY_DEPARTMENTS[n];
  return null;
}

module.exports = {
  TAXONOMY, DEPARTMENTS, DEFAULT_DEPARTMENT, LEGACY_DEPARTMENTS,
  departmentById, taxonomyById, departmentOrder, legacyDepartmentId,
};
