import { ById } from 'rxdb/plugins/core';

export async function postRequest(
    url: string,
    body: any,
    headers: ById<string> = {},
) {
    const request = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: Object.assign({
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }, headers),
        body: JSON.stringify(body)
    });
    const response = await request.json();
    return response;
}
