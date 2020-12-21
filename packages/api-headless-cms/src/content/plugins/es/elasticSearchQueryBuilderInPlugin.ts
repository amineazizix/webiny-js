import { ElasticSearchQueryBuilderPlugin } from "@webiny/api-headless-cms/types";

export const elasticSearchQueryBuilderInPlugin = (): ElasticSearchQueryBuilderPlugin => ({
    type: "elastic-search-query-builder",
    name: "elastic-search-query-builder-in",
    targetOperation: "in",
    apply(query, { field, value: values }) {
        if (Array.isArray(values) === false || values.length === 0) {
            throw new Error(
                `You cannot filter field "${field}" with "in" operator and not send an array of values.`
            );
        }
        const should = values.map(value => {
            return {
                term: {
                    [field]: value
                }
            };
        });
        query.should.push(...should);
    }
});
