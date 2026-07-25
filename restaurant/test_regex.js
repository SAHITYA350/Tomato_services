const content = 'Namaste! 🙏 Ah, veg! 🥗 Let me see what I can find for you. <function=semanticSearch>{"query": "vegetarian food"} </function>';
console.log(/<function=([^>]+)>/.test(content));
console.log(content.match(/<function=([^>]+)>(.*?)<\/function>/is));
