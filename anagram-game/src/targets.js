// Anagram Adventure target words by length, most common first (words are drawn in list order).
// Plain vocabulary: lower-case a-z only, no proper nouns, no offensive terms, no names (D-043).
window.ANAGRAM_TARGETS = {
  3: [
    "cat","ten","sun","dog","pen","hat","cup","bed","car","bus","box","cow","egg","fox","hen","jam",
    "key","leg","map","net","owl","pig","rug","sea","toy","van","web","bag","cap","fan","gum","hut",
    "ink","jar","kid","lip","mud","nut","oak","pan","rat","sky","tub","urn","wig","yak","zoo","arm",
    "bat","bee","cab","day","ear","fig","gap","hop","ice","jet","log","mat","pie","ram","sip","tin",
    "vet","wax","zip","bow"
  ],
  4: [
    "time","year","work","word","home","life","hand","part","food","name","land","game","book","door","room","road",
    "tree","star","rain","wind","fire","moon","gold","blue","cake","farm","fish","bird","ship","boat","song","rock",
    "sand","snow","bell","coat","hill","lake","milk","seed","wave","wood","bone","rope","salt","silk","park","mind",
    "plan","ring","rice","soap","tent","tour","vase","wool","yard","jazz","mask","nest","oven","palm","reed","tide",
    "vine","weed","fern","glow","hawk","lamp","mint","oats"
  ],
  5: [
    "stone","water","house","plant","light","music","table","chair","bread","river","heart","clock","dream","earth","field","grass",
    "horse","lemon","money","night","ocean","paper","pearl","piano","queen","radio","salad","shell","smile","sugar","tiger","train",
    "wheel","world","apple","beach","cloud","dance","flame","glass","honey","image","jewel","knife","lunch","maple","olive","pilot",
    "quilt","robin","stamp","tooth","unity","valve","whale","yield","amber","brush","coral","daisy","eagle","fable","grape","hinge",
    "ivory","joker"
  ],
  6: [
    "garden","bridge","castle","dinner","family","forest","friend","island","jungle","kitten","letter","market","number","orange","planet","pocket",
    "rabbit","school","spring","summer","winter","window","yellow","basket","candle","engine","flower","guitar","hammer","insect","jacket","kettle",
    "ladder","mirror","napkin","pepper","rocket","silver","ticket","valley","wallet","anchor","bottle","canyon","donkey","farmer","gentle","harbor",
    "magnet","nature","paddle","quartz","ribbon","saddle","tunnel","velvet","walnut","zipper","breeze","cobweb","dragon","fabric"
  ],
  7: [
    "journey","kitchen","morning","picture","machine","mystery","blanket","chicken","diamond","evening","fortune","giraffe","history","imagine","lantern","monitor",
    "network","octopus","pattern","quality","reading","station","teacher","unicorn","village","weather","whisper","balance","captain","dolphin","element","fiction",
    "harvest","insight","justice","kingdom","library","musical","nothing","outside","penguin","quarter","rainbow","sailing","someday","trouble","uniform","venture",
    "warrior","explore","freedom","glimpse","holiday","inquire","lullaby","mineral","cabinet","orchard","plastic","quicken"
  ],
  8: [
    "mountain","computer","building","elephant","favorite","hospital","umbrella","calendar","birthday","chemical","daughter","engineer","football","generous","homework","absolute",
    "language","medicine","notebook","ordinary","painting","question","relative","sandwich","teaching","universe","vacation","wardrobe","anywhere","bathroom","creative","distance",
    "evidence","festival","graceful","handsome","identity","judgment","keyboard","lifetime","magazine","mushroom","operator","platform","quantity","reaction","scenario","treasure",
    "ultimate","vineyard","wildlife","ancestor","sunshine","champion","dolphins","exercise","forecast","guardian","hardware","indirect"
  ],
  9: [
    "adventure","beautiful","chocolate","dangerous","excellent","framework","geography","happiness","important","knowledge","landscape","adjective","wonderful","vegetable","telephone","sunflower",
    "classroom","telescope","afternoon","butterfly","challenge","delicious","education","fantastic","generator","hurricane","invention","jellyfish","lightning","mountains","newspaper","orchestra",
    "paragraph","quotation","remainder","sandstorm","technique","universal","elephants","waterfall","yesterday","algorithm","blueberry","calendars","equipment","elevation","fireplace","gardening",
    "community","invisible","juxtapose","kilometer","snowflake","treasures","nightmare","overnight","pineapple","quicksand","rectangle","scrapbook"
  ]
};
if (typeof module !== "undefined") module.exports = window.ANAGRAM_TARGETS;
