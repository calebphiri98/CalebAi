const searchWeb = async (query) => {
    if (!process.env.TAVILY_API_KEY) {
        throw new Error("TAVILY_API_KEY is missing");
    }

    const response = await fetch("https://api.tavily.com/search", {
        method: "POST",

        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.TAVILY_API_KEY}`
        },

        body: JSON.stringify({
            query,
            search_depth: "basic",
            topic: "general",
            max_results: 5
        })
    });

    if (!response.ok) {
        const errorText = await response.text();

        throw new Error(
            `Tavily search failed: ${response.status} ${errorText}`
        );
    }

    const data = await response.json();

    return data.results || [];
};

module.exports = {
    searchWeb
};