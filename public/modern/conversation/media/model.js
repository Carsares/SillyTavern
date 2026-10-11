export function mediaType(mime = '') {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    return 'file';
}
export function attachmentPart(record) {
    if (!record?.id || !record.mime) throw new Error('服务器未返回完整附件信息');
    return { type: mediaType(record.mime), attachmentId: record.id, mimeType: record.mime, name: record.name, size: record.size };
}
export function assertMediaCapability(capability, media) {
    if (!media.length) return;
    if (capability?.supported !== true || !Array.isArray(capability.media)) throw new Error('当前连接尚未声明媒体支持，附件不能发送');
    for (const part of media) if (!capability.media.includes(part.type)) throw new Error(`当前连接不支持 ${part.type} 输入；附件仍保留在草稿中`);
}
export function encodeBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
}
