export function wrongImport() {
    throw new Error('You should never import this file, only the server plugins');
}
