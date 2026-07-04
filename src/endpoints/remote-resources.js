import express from 'express';

import { getRemoteResourceProviders, searchRemoteResources, downloadRemoteResource } from '../remote-resources/provider-registry.js';
import { addRemoteImportRecord, deleteRemoteImportRecord, readRemoteImportRecords } from '../remote-resources/import-records.js';
import { removeRemoteCredential, saveRemoteCredential } from '../remote-resources/credentials.js';

export const router = express.Router();

router.get('/providers', async (request, response) => {
    try {
        return response.send(getRemoteResourceProviders(request.user.directories));
    } catch (error) {
        console.error('Failed to list remote resource providers:', error);
        return response.sendStatus(500);
    }
});

router.post('/search', async (request, response) => {
    try {
        const result = await searchRemoteResources(request.body || {}, request.user.directories);
        return response.send(result);
    } catch (error) {
        console.error('Failed to search remote resources:', error);
        return response.status(500).send({ items: [], total: 0, errors: [error.message] });
    }
});

router.post('/download', async (request, response) => {
    try {
        const result = await downloadRemoteResource(request.body || {}, request.user.directories);
        response.set('Content-Type', result.fileType || 'application/octet-stream');
        response.set('Content-Disposition', `attachment; filename="${encodeURI(result.fileName)}"`);
        response.set('X-Remote-Resource-Type', result.resourceType || '');
        return response.send(result.buffer);
    } catch (error) {
        console.error('Failed to download remote resource:', error);
        return response.status(500).send(error.message);
    }
});

router.get('/records', (request, response) => {
    try {
        return response.send(readRemoteImportRecords(request.user.directories));
    } catch (error) {
        console.error('Failed to read remote import records:', error);
        return response.sendStatus(500);
    }
});

router.post('/records', (request, response) => {
    try {
        const record = addRemoteImportRecord(request.user.directories, request.body || {});
        return response.send(record);
    } catch (error) {
        console.error('Failed to save remote import record:', error);
        return response.sendStatus(500);
    }
});

router.delete('/records/:id', (request, response) => {
    try {
        deleteRemoteImportRecord(request.user.directories, request.params.id);
        return response.sendStatus(204);
    } catch (error) {
        console.error('Failed to delete remote import record:', error);
        return response.sendStatus(500);
    }
});

router.post('/credentials', (request, response) => {
    try {
        const { providerId, credentialId, value } = request.body || {};
        const id = saveRemoteCredential(request.user.directories, providerId, credentialId, value);
        return response.send({ id, providers: getRemoteResourceProviders(request.user.directories) });
    } catch (error) {
        console.error('Failed to save remote credential:', error);
        return response.status(400).send(error.message);
    }
});

router.delete('/credentials', (request, response) => {
    try {
        const { providerId, credentialId } = request.body || {};
        removeRemoteCredential(request.user.directories, providerId, credentialId);
        return response.send({ providers: getRemoteResourceProviders(request.user.directories) });
    } catch (error) {
        console.error('Failed to remove remote credential:', error);
        return response.status(400).send(error.message);
    }
});
