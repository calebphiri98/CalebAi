require("dotenv").config();

const { searchWeb } = require("./src/services/webSearch.service.js");

const test = async () => {
    try {
        const results = await searchWeb(
            "current president of Malawi"
        );

        console.log(JSON.stringify(results, null, 2));

    } catch (error) {
        console.error("SEARCH TEST FAILED:");
        console.error(error.message);
    }
};

test();