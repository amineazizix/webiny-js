import mdbid from "mdbid";
import { ContextPlugin } from "@webiny/handler/types";
import { ErrorResponse, NotFoundError } from "@webiny/handler-graphql";
import Error from "@webiny/error";
import {
    CmsContentModelEntryContextType,
    CmsContentModelEntryPermissionType,
    CmsContentModelEntryType,
    CmsContentModelType,
    CmsContext,
    DbItemTypes
} from "@webiny/api-headless-cms/types";
import * as utils from "../../../utils";
import { validateModelEntryData } from "./contentModelEntry/entryDataValidation";
import {
    createElasticSearchParams,
    createElasticSearchLimit
} from "./contentModelEntry/elasticSearchHelpers";
import { createRevisionsDataLoader } from "./contentModelEntry/dataLoaders";
import { createCmsPK } from "../../../utils";

const TYPE_ENTRY = "cms.entry";
const TYPE_ENTRY_LATEST = TYPE_ENTRY + ".l";
const TYPE_ENTRY_PUBLISHED = TYPE_ENTRY + ".p";

const STATUS_DRAFT = "draft";
const STATUS_PUBLISHED = "published";
const STATUS_UNPUBLISHED = "unpublished";
const STATUS_CHANGES_REQUESTED = "changesRequested";
const STATUS_REVIEW_REQUESTED = "reviewRequested";

const createElasticSearchData = ({ values, ...entry }: CmsContentModelEntryType) => {
    return {
        ...entry,
        values: {
            // Keep "values" as a nested object to avoid collisions between
            // system and user-defined properties
            ...values
        }
    };
};

const getESLatestEntryData = (entry: CmsContentModelEntryType) => {
    return { ...createElasticSearchData(entry), latest: true, __type: TYPE_ENTRY_LATEST };
};

const getESPublishedEntryData = (entry: CmsContentModelEntryType) => {
    return { ...createElasticSearchData(entry), published: true, __type: TYPE_ENTRY_PUBLISHED };
};

export default (): ContextPlugin<CmsContext> => ({
    type: "context",
    name: "context-content-model-entry",
    async apply(context) {
        const { db, elasticSearch, security } = context;

        const PK_ENTRY = () => `${createCmsPK(context)}#CME`;
        const PK_ENTRY_LATEST = () => PK_ENTRY() + "#L";
        const PK_ENTRY_PUBLISHED = () => PK_ENTRY + "#P";

        const loaders = {
            revisions: createRevisionsDataLoader(context, { PK_ENTRY })
        };

        const checkPermissions = (check: {
            rwd?: string;
            rcpu?: string;
        }): Promise<CmsContentModelEntryPermissionType> => {
            return utils.checkPermissions(context, "cms.manage.contentModelEntry", check);
        };

        const entries: CmsContentModelEntryContextType = {
            get: async (model, args) => {
                const permission = await checkPermissions({ rwd: "r" });
                utils.checkEntryAccess(context, permission, model);

                const [[item]] = await context.cms.entries.list(model, {
                    ...args,
                    limit: 1
                });
                if (!item) {
                    throw new NotFoundError(`Entry not found!`);
                }
                return item;
            },
            list: async (model: CmsContentModelType, args = {}, options = {}) => {
                const permission = await checkPermissions({ rwd: "r" });
                utils.checkEntryAccess(context, permission, model);

                const limit = createElasticSearchLimit(args.limit, 50);

                // Possibly only get records which are owned by current user
                const ownedBy = permission.own ? context.security.getIdentity().id : undefined;

                const body = createElasticSearchParams({
                    model,
                    args: {
                        ...args,
                        where: {
                            ...(args.where || {}),
                            modelId: model.modelId
                        },
                        limit
                    },
                    context,
                    ownedBy,
                    parentObject: "values",
                    options
                });

                let response;
                try {
                    response = await elasticSearch.search({
                        ...utils.defaults.es(context),
                        body
                    });
                } catch (ex) {
                    throw new ErrorResponse({
                        message: ex.message,
                        code: ex.code,
                        data: ex.meta
                    });
                }

                const { hits, total } = response.body.hits;
                const items = hits.map(item => item._source);

                const hasMoreItems = items.length > limit;
                if (hasMoreItems) {
                    // Remove the last item from results, we don't want to include it.
                    items.pop();
                }

                // Cursor is the `sort` value of the last item in the array.
                // https://www.elastic.co/guide/en/elasticsearch/reference/current/paginate-search-results.html#search-after
                const meta = {
                    hasMoreItems,
                    totalCount: total.value,
                    cursor:
                        items.length > 0
                            ? utils.encodeElasticSearchCursor(hits[items.length - 1].sort)
                            : null
                };

                return [items, meta];
            },
            listLatest: async function(model, args) {
                return context.cms.entries.list(
                    model,
                    {
                        sort: ["savedOn_DESC"],
                        ...args
                    },
                    {
                        type: TYPE_ENTRY_LATEST
                    }
                );
                /*
                const permission = await checkPermissions({ rwd: "r" });
                const locale = context.cms.getLocale();

                const must: any = [
                    { term: { "__type.keyword": TYPE_ENTRY_LATEST } },
                    { term: { "modelId.keyword": model.modelId } },
                    { term: { "locale.keyword": locale.code } }
                ];

                // Only get records which are owned by current user.
                if (permission.own === true) {
                    const identity = context.security.getIdentity();
                    must.push({
                        term: { "ownedBy.id.keyword": identity.id }
                    });
                }

                const body = {
                    query: {
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        constant_score: {
                            filter: { bool: { must } }
                        }
                    },
                    sort: [
                        {
                            savedOn: {
                                order: "desc",
                                // eslint-disable-next-line @typescript-eslint/camelcase
                                unmapped_type: "date"
                            }
                        }
                    ],
                    size: 1000
                };

                // Get "latest" form revisions from Elasticsearch.
                const response = await elasticSearch.search({
                    ...utils.defaults.es(context),
                    body
                });

                const { hits, total } = response.body.hits;
                const items = hits.map(item => item._source);

                const meta = {
                    hasMoreItems: false,
                    totalCount: total.value,
                    cursor: null
                };

                return [items, meta];
                // */
            },
            listPublished: async function(model, args) {
                return context.cms.entries.list(
                    model,
                    {
                        sort: ["savedOn_DESC"],
                        ...args
                    },
                    {
                        type: TYPE_ENTRY_PUBLISHED
                    }
                );
                // const locale = context.cms.getLocale();
                //
                // const must: any = [
                //     { term: { "__type.keyword": TYPE_ENTRY_PUBLISHED } },
                //     { term: { "modelId.keyword": model.modelId } },
                //     { term: { "locale.keyword": locale.code } }
                // ];
                //
                // const body = {
                //     query: {
                //         // eslint-disable-next-line @typescript-eslint/camelcase
                //         constant_score: {
                //             filter: { bool: { must } }
                //         }
                //     },
                //     sort: [
                //         {
                //             savedOn: {
                //                 order: "desc",
                //                 // eslint-disable-next-line @typescript-eslint/camelcase
                //                 unmapped_type: "date"
                //             }
                //         }
                //     ],
                //     size: 1000
                // };
                //
                // // Get "published" form revisions from Elasticsearch.
                // const response = await elasticSearch.search({
                //     ...utils.defaults.es(context),
                //     body
                // });
                //
                // const { hits, total } = response.body.hits;
                // const items = hits.map(item => item._source);
                //
                // const meta = {
                //     hasMoreItems: false,
                //     totalCount: total.value,
                //     cursor: null
                // };
                //
                // return [items, meta];
            },
            async create(model, inputData) {
                const permission = await checkPermissions({ rwd: "w" });
                utils.checkEntryAccess(context, permission, model);

                // Make sure we only work with fields that are defined in the model.
                const data = model.fields.reduce((acc, field) => {
                    if (field.fieldId in inputData) {
                        acc[field.fieldId] = inputData[field.fieldId];
                    }

                    return acc;
                }, {});

                await validateModelEntryData(context, model, data);

                const identity = security.getIdentity();
                const locale = context.cms.getLocale();

                const uniqueId = mdbid();
                const version = 1;
                const id = `${uniqueId}#${utils.zeroPad(version)}`;

                const owner = {
                    id: identity.id,
                    displayName: identity.displayName,
                    type: identity.type
                };

                const entry: CmsContentModelEntryType = {
                    id,
                    modelId: model.modelId,
                    locale: locale.code,
                    createdOn: new Date().toISOString(),
                    savedOn: new Date().toISOString(),
                    createdBy: owner,
                    ownedBy: owner,
                    version,
                    locked: false,
                    status: STATUS_DRAFT,
                    values: data
                };

                await db
                    .batch()
                    // Create main entry item
                    .create({
                        ...utils.defaults.db,
                        data: {
                            PK: PK_ENTRY(),
                            SK: id,
                            TYPE: DbItemTypes.CMS_CONTENT_MODEL_ENTRY,
                            ...entry
                        }
                    })
                    // Create "latest" entry item
                    .create({
                        ...utils.defaults.db,
                        data: {
                            PK: PK_ENTRY_LATEST(),
                            SK: uniqueId,
                            TYPE: TYPE_ENTRY_LATEST,
                            id
                        }
                    })
                    .execute();

                await elasticSearch.create({
                    ...utils.defaults.es(context),
                    id: `CME#L#${uniqueId}`,
                    body: getESLatestEntryData(entry)
                });

                return entry;
            },
            async createRevisionFrom(model, sourceId) {
                const permission = await checkPermissions({ rwd: "w" });
                utils.checkEntryAccess(context, permission, model);

                // Entries are identified by a common parent ID + Revision number
                const [uniqueId] = sourceId.split("#");

                const [[[entry]], [[latestEntry]]] = await db
                    .batch()
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY(), SK: sourceId }
                    })
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY_LATEST(), SK: uniqueId }
                    })
                    .execute();

                if (!entry) {
                    throw new NotFoundError(
                        `Entry "${sourceId}" of model "${model.modelId}" was not found.`
                    );
                }

                const identity = security.getIdentity();
                const version = parseInt(latestEntry.id.split("#")[1]) + 1;
                const id = `${uniqueId}#${utils.zeroPad(version)}`;

                const newEntry: CmsContentModelEntryType = {
                    id,
                    version,
                    modelId: entry.modelId,
                    locale: entry.locale,
                    savedOn: new Date().toISOString(),
                    createdOn: new Date().toISOString(),
                    createdBy: {
                        id: identity.id,
                        displayName: identity.displayName,
                        type: identity.type
                    },
                    ownedBy: entry.ownedBy,
                    locked: false,
                    publishedOn: null,
                    status: STATUS_DRAFT,
                    values: { ...entry.values }
                };

                await db
                    .batch()
                    // Create main entry item
                    .create({
                        ...utils.defaults.db,
                        data: {
                            PK: PK_ENTRY(),
                            SK: id,
                            TYPE: DbItemTypes.CMS_CONTENT_MODEL_ENTRY,
                            ...newEntry
                        }
                    })
                    // Update "latest" entry item
                    .update({
                        ...utils.defaults.db,
                        data: {
                            PK: PK_ENTRY_LATEST(),
                            SK: uniqueId,
                            TYPE: TYPE_ENTRY_LATEST,
                            id
                        }
                    })
                    .execute();

                await elasticSearch.index({
                    ...utils.defaults.es(context),
                    id: `CME#L#${uniqueId}`,
                    body: getESLatestEntryData(newEntry)
                });

                return newEntry;
            },
            async update(model, id, inputData) {
                const permission = await checkPermissions({ rwd: "w" });
                utils.checkEntryAccess(context, permission, model);

                // Make sure we only work with fields that are defined in the model.
                const data = model.fields.reduce((acc, field) => {
                    acc[field.fieldId] = inputData[field.fieldId];
                    return acc;
                }, {});

                // Validate data early. We don't want to query DB if input data is invalid.
                await validateModelEntryData(context, model, data);

                // Now we know the data is valid, proceed with DB calls.
                const [uniqueId] = id.split("#");

                const [[[entry]], [[latestEntry]]] = await db
                    .batch()
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY(), SK: id }
                    })
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY_LATEST(), SK: uniqueId }
                    })
                    .execute();

                if (!entry) {
                    throw new NotFoundError(
                        `Entry "${id}" of model "${model.modelId}" was not found.`
                    );
                }

                if (entry.locked) {
                    throw new Error(`Cannot update entry because it's locked.`);
                }

                utils.checkOwnership(context, permission, entry, "ownedBy");

                const updatedEntry: Partial<CmsContentModelEntryType> = {
                    values: data,
                    savedOn: new Date().toISOString()
                };

                await db.update({
                    ...utils.defaults.db,
                    query: { PK: PK_ENTRY(), SK: id },
                    data: updatedEntry
                });

                if (latestEntry.id === id) {
                    // Index file in "Elastic Search"
                    await elasticSearch.update({
                        ...utils.defaults.es(context),
                        id: `CME#L#${uniqueId}`,
                        body: {
                            doc: updatedEntry
                        }
                    });
                }

                return {
                    ...entry,
                    ...updatedEntry
                };
            },
            async delete(model, id) {
                const permission = await checkPermissions({ rwd: "d" });
                utils.checkEntryAccess(context, permission, model);

                const [uniqueId] = id.split("#");

                const [[[entry]], [[latestEntryData]], [[publishedEntryData]]] = await db
                    .batch()
                    .read({
                        ...utils.defaults.db,
                        query: {
                            PK: PK_ENTRY(),
                            SK: id
                        }
                    })
                    .read({
                        ...utils.defaults.db,
                        query: {
                            PK: PK_ENTRY_LATEST(),
                            SK: uniqueId
                        }
                    })
                    .read({
                        ...utils.defaults.db,
                        query: {
                            PK: PK_ENTRY_PUBLISHED(),
                            SK: uniqueId
                        }
                    })
                    .execute();

                if (!entry) {
                    throw new NotFoundError(`Entry "${id}" was not found!`);
                }

                utils.checkOwnership(context, permission, entry, "ownedBy");

                // Delete entry from DB
                const batch = db.batch().delete({
                    ...utils.defaults.db,
                    query: {
                        PK: PK_ENTRY(),
                        SK: id
                    }
                });

                const es = utils.defaults.es(context);
                const esOperations = [];

                const isLatest = latestEntryData ? latestEntryData.id === id : false;
                const isPublished = publishedEntryData ? publishedEntryData.id === id : false;

                // If the entry is published, remove published data, both from DB and ES.
                if (isPublished) {
                    batch.delete({
                        ...utils.defaults.db,
                        query: {
                            PK: PK_ENTRY_PUBLISHED(),
                            SK: uniqueId
                        }
                    });

                    esOperations.push({
                        delete: { _id: `CME#P#${uniqueId}`, _index: es.index }
                    });
                }

                // If the entry is "latest", assign the previously latest entry as the new latest.
                // Updates must be made on both DB and ES side.
                if (isLatest) {
                    const [[prevLatestEntry]] = await db.read<CmsContentModelEntryType>({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY(), SK: { $lt: id } },
                        sort: { SK: -1 },
                        limit: 1
                    });

                    // Update latest entry data.
                    batch.update({
                        ...utils.defaults.db,
                        query: {
                            PK: PK_ENTRY_LATEST(),
                            SK: uniqueId
                        },
                        data: {
                            ...latestEntryData,
                            id: prevLatestEntry.id
                        }
                    });

                    // Update the latest revision entry in ES.
                    esOperations.push(
                        { index: { _id: `CME#L#${uniqueId}`, _index: es.index } },
                        getESLatestEntryData(prevLatestEntry)
                    );
                }

                // Execute DB operations
                await batch.execute();

                // If the entry was neither published nor latest, we shouldn't have any operations to execute.
                if (esOperations.length) {
                    await elasticSearch.bulk({ body: esOperations });
                }
            },
            async listRevisions(id) {
                const [uniqueId] = id.split("#");

                return loaders.revisions.load(uniqueId);
            },
            async publish(model, id) {
                const permission = await checkPermissions({ rcpu: "p" });
                utils.checkEntryAccess(context, permission, model);

                const [uniqueId] = id.split("#");

                const [[[entry]], [[latestEntryData]], [[publishedEntryData]]] = await db
                    .batch()
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY(), SK: id }
                    })
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY_LATEST(), SK: uniqueId }
                    })
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY_PUBLISHED(), SK: uniqueId }
                    })
                    .execute();

                if (!entry) {
                    throw new NotFoundError(
                        `Entry "${id}" of model "${model.modelId}" was not found.`
                    );
                }

                utils.checkOwnership(context, permission, entry, "ownedBy");

                // Change entry to "published"
                entry.status = STATUS_PUBLISHED;
                entry.locked = true;
                entry.publishedOn = new Date().toISOString();

                const batch = db.batch();

                batch.update({
                    ...utils.defaults.db,
                    query: {
                        PK: PK_ENTRY(),
                        SK: id
                    },
                    data: entry
                });

                if (publishedEntryData) {
                    // If there is a `published` entry already, we need to set it to `unpublished`. We need to
                    // execute two updates: update the previously published entry's status and the published
                    // entry record (PK_ENTRY_PUBLISHED()).

                    // DynamoDB does not support `batchUpdate` - so here we load the previously published
                    // entry's data to update its status within a batch operation. If, hopefully,
                    // they introduce a true update batch operation, remove this `read` call.

                    const [[previouslyPublishedEntry]] = await db.read<CmsContentModelEntryType>({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY(), SK: publishedEntryData.id }
                    });

                    previouslyPublishedEntry.status = STATUS_UNPUBLISHED;

                    batch
                        .update({
                            // Update currently published entry (unpublish it)
                            ...utils.defaults.db,
                            query: {
                                PK: PK_ENTRY(),
                                SK: publishedEntryData.id
                            },
                            data: previouslyPublishedEntry
                        })
                        .update({
                            // Update the helper item in DB with the new published entry ID
                            ...utils.defaults.db,
                            query: {
                                PK: PK_ENTRY_PUBLISHED(),
                                SK: uniqueId
                            },
                            data: {
                                ...publishedEntryData,
                                id: entry.id
                            }
                        });
                } else {
                    batch.create({
                        ...utils.defaults.db,
                        data: {
                            PK: PK_ENTRY_PUBLISHED(),
                            SK: uniqueId,
                            TYPE: TYPE_ENTRY_PUBLISHED,
                            id: entry.id
                        }
                    });
                }

                // Finally, execute batch
                await batch.execute();

                // Update data in ES.
                const esOperations = [];
                const es = utils.defaults.es(context);

                // If we are publishing the latest revision, let's also update the latest revision's status in ES.
                if (latestEntryData && latestEntryData.id === id) {
                    esOperations.push(
                        { update: { _id: `CME#L#${uniqueId}`, _index: es.index } },
                        {
                            doc: {
                                status: STATUS_PUBLISHED,
                                locked: true,
                                publishedOn: entry.publishedOn
                            }
                        }
                    );
                }

                // Update the published revision entry in ES.
                esOperations.push(
                    { index: { _id: `CME#P#${uniqueId}`, _index: es.index } },
                    getESPublishedEntryData(entry)
                );

                await elasticSearch.bulk({ body: esOperations });

                return entry;
            },
            async requestChanges(model, id) {
                const permission = await checkPermissions({ rcpu: "c" });
                const [uniqueId] = id.split("#");

                const [[[entry]], [[latestEntryData]]] = await db
                    .batch()
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY(), SK: id }
                    })
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY_LATEST(), SK: uniqueId }
                    })
                    .execute();

                if (!entry) {
                    throw new NotFoundError(
                        `Entry "${id}" of model "${model.modelId}" was not found.`
                    );
                }

                if (entry.status !== STATUS_REVIEW_REQUESTED) {
                    throw new Error(
                        "Cannot request changes on an entry that's not under review.",
                        "ENTRY_NOT_UNDER_REVIEW"
                    );
                }

                const identity = context.security.getIdentity();
                if (entry.ownedBy.id === identity.id) {
                    throw new Error(
                        "You cannot request changes on your own entry.",
                        "CANNOT_REQUEST_CHANGES_ON_OWN_ENTRY"
                    );
                }

                utils.checkOwnership(context, permission, entry, "ownedBy");

                // Change entry's status.
                const updatedData = {
                    status: STATUS_CHANGES_REQUESTED,
                    locked: false
                };

                await db.update({
                    ...utils.defaults.db,
                    query: {
                        PK: PK_ENTRY(),
                        SK: id
                    },
                    data: updatedData
                });

                // If we updated the latest version, then make sure the changes are propagated to ES too.
                if (latestEntryData.id === id) {
                    // Index file in "Elastic Search"
                    await elasticSearch.update({
                        ...utils.defaults.es(context),
                        id: `CME#L#${uniqueId}`,
                        body: {
                            doc: {
                                status: STATUS_CHANGES_REQUESTED,
                                locked: false
                            }
                        }
                    });
                }

                return Object.assign(entry, updatedData);
            },
            async requestReview(model, id) {
                const permission = await checkPermissions({ rcpu: "r" });
                const [uniqueId] = id.split("#");

                const results = await db
                    .batch()
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY(), SK: id }
                    })
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY_LATEST(), SK: uniqueId }
                    })
                    .execute();

                const entry: CmsContentModelEntryType = results[0][0];
                const latestEntryData: { id: string } = results[1][0];

                if (!entry) {
                    throw new NotFoundError(
                        `Entry "${id}" of model "${model.modelId}" was not found.`
                    );
                }

                const allowedStatuses = [STATUS_DRAFT, STATUS_CHANGES_REQUESTED];
                if (!allowedStatuses.includes(entry.status)) {
                    throw new Error(
                        "Cannot request review - entry is not a draft nor was a change request issued."
                    );
                }

                utils.checkOwnership(context, permission, entry, "ownedBy");

                // Change entry's status.
                const updatedData = {
                    status: STATUS_REVIEW_REQUESTED,
                    locked: true
                };

                await db.update({
                    ...utils.defaults.db,
                    query: {
                        PK: PK_ENTRY(),
                        SK: id
                    },
                    data: updatedData
                });

                // If we updated the latest version, then make sure the changes are propagated to ES too.
                if (latestEntryData.id === id) {
                    // Index file in "Elastic Search"
                    await elasticSearch.update({
                        ...utils.defaults.es(context),
                        id: `CME#L#${uniqueId}`,
                        body: {
                            doc: {
                                status: STATUS_REVIEW_REQUESTED,
                                locked: true
                            }
                        }
                    });
                }

                return Object.assign(entry, updatedData);
            },
            async unpublish(model, id) {
                const permission = await checkPermissions({ rcpu: "u" });

                const [uniqueId] = id.split("#");

                const [[[entry]], [[latestEntryData]], [[publishedEntryData]]] = await db
                    .batch()
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY(), SK: id }
                    })
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY_LATEST(), SK: uniqueId }
                    })
                    .read({
                        ...utils.defaults.db,
                        query: { PK: PK_ENTRY_PUBLISHED(), SK: uniqueId }
                    })
                    .execute();

                if (!entry) {
                    throw new NotFoundError(
                        `Entry "${id}" of model "${model.modelId}" was not found.`
                    );
                }

                utils.checkOwnership(context, permission, entry, "ownedBy");

                if (!publishedEntryData || publishedEntryData.id !== id) {
                    throw new Error(`Entry "${id}" is not published.`);
                }

                entry.status = STATUS_UNPUBLISHED;

                await db
                    .batch()
                    .delete({
                        ...utils.defaults.db,
                        query: {
                            PK: PK_ENTRY_PUBLISHED(),
                            SK: id
                        }
                    })
                    .update({
                        ...utils.defaults.db,
                        query: {
                            PK: PK_ENTRY_PUBLISHED(),
                            SK: uniqueId
                        },
                        data: entry
                    })
                    .execute();

                // Update data in ES.
                const es = utils.defaults.es(context);
                const esOperations = [];

                // If we are unpublishing the latest revision, let's also update the latest revision entry's status in ES.
                if (latestEntryData.id === id) {
                    esOperations.push(
                        { update: { _id: `CME#L#${uniqueId}`, _index: es.index } },
                        { doc: { status: STATUS_UNPUBLISHED } }
                    );
                }

                // Delete the published revision entry in ES.
                esOperations.push({
                    delete: { _id: `CME#P#${uniqueId}`, _index: es.index }
                });

                await elasticSearch.bulk({ body: esOperations });

                return entry;
            }
        };

        context.cms = {
            ...(context.cms || ({} as any)),
            entries
        };
    }
});
