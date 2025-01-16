export function customFetchWithFixedHeaders(headers: any){
    function customFetch(url: string | URL, options: any = {}) {
        // Ensure options object exists and headers property is initialized
        options.headers = {
            ...headers,              // include default custom headers
            ...(options.headers || {})            // merge any headers passed in the function call
        };

        // Call the original fetch with the modified options
        return fetch(url, options);
    }
    return customFetch;
}

