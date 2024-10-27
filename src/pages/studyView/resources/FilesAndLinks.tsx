import * as React from 'react';
import {
    Column,
    default as LazyMobXTable,
} from 'shared/components/lazyMobXTable/LazyMobXTable';
import { observer } from 'mobx-react';
import _ from 'lodash';
import internalClient from 'shared/api/cbioportalInternalClientInstance';
import { Else, If, Then } from 'react-if';
import { WindowWidthBox } from '../../../shared/components/WindowWidthBox/WindowWidthBox';
import LoadingIndicator from 'shared/components/loadingIndicator/LoadingIndicator';
import {
    getResourceViewUrlWithPathname,
    getSampleViewUrlWithPathname,
    getPatientViewUrlWithPathname,
} from 'shared/api/urls';
import { getAllClinicalDataByStudyViewFilter } from '../StudyViewUtils';
import { StudyViewPageStore } from 'pages/studyView/StudyViewPageStore';
import { isUrl, remoteData } from 'cbioportal-frontend-commons';
import { makeObservable, observable, computed } from 'mobx';
import {
    ResourceData,
    ClinicalData,
    StudyViewFilter,
} from 'cbioportal-ts-api-client';

export interface IFilesLinksTable {
    store: StudyViewPageStore;
}

class FilesLinksTableComponent extends LazyMobXTable<{
    [id: string]: string | number;
}> {}

const RECORD_LIMIT = 500;

function getResourceDataOfEntireStudy(studyClinicalData: {
    [uniqueSampleKey: string]: ClinicalData[];
}) {
    // Need a better way to get just the studyId
    const studyId = Object.values(studyClinicalData)[0][0]['studyId'];

    const allResources = internalClient.getAllStudyResourceDataInStudyPatientSampleUsingGET(
        {
            studyId: studyId,
            projection: 'DETAILED',
        }
    );
    console.log(allResources);
    // Need to filter out allResources to only the patients selected in the
    // studyClinicalData
    // TODO

    return allResources;
}

function getResourceDataOfPatients(studyClinicalData: {
    [uniqueSampleKey: string]: ClinicalData[];
}) {
    const resourcesPerPatient = _(studyClinicalData)
        .flatMap(clinicaldataItems => clinicaldataItems)
        .uniqBy('patientId')
        .map(resource =>
            internalClient.getAllResourceDataOfPatientInStudyUsingGET({
                studyId: resource.studyId,
                patientId: resource.patientId,
                projection: 'DETAILED',
            })
        )
        .flatten()
        .value();
    console.log(resourcesPerPatient); // All PROMISES

    return Promise.all(resourcesPerPatient).then(resourcesPerPatient =>
        _(resourcesPerPatient)
            .flatMap()
            .groupBy('patientId')
            .value()
    );
}

function buildItemsAndResources(resourceData: {
    [key: string]: ResourceData[];
}) {
    const resourcesPerPatient = _.reduce(
        resourceData,
        (resourcesPerPatient, data) => {
            if (data && data.length > 0) {
                const patientId = data[0]?.patientId;
                if (patientId) {
                    resourcesPerPatient[patientId] =
                        (resourcesPerPatient[patientId] || 0) + data.length;
                }
            }

            return resourcesPerPatient;
        },
        {} as { [key: string]: number }
    );

    const items: { [attributeId: string]: string | number }[] = _(resourceData)
        .flatMap(data =>
            data.map(resource => ({
                studyId: resource.studyId,
                patientId: resource.patientId,
                sampleId: resource.sampleId,
                resourcesPerPatient: 0,
                typeOfResource: resource?.resourceDefinition?.displayName,
                description: resource?.resourceDefinition?.description,
                url: resource?.url,
                resourceId: resource?.resourceId,
            }))
        )
        .value();

    return { resourcesPerPatient, items };
}

async function fetchFilesLinksData(
    filters: StudyViewFilter,
    // sampleIdResourceData: { [sampleId: string]: ResourceData[] },
    searchTerm: string | undefined,
    sortAttributeId: string | undefined,
    sortDirection: 'asc' | 'desc' | undefined,
    recordLimit: number
) {
    const studyClinicalDataResponse = await getAllClinicalDataByStudyViewFilter(
        filters,
        searchTerm,
        sortAttributeId,
        sortDirection,
        recordLimit,
        0
    );

    // Fetching resource data of patients
    // const resourcesForPatients = await getResourceDataOfPatients(
    //     studyClinicalDataResponse.data // The studyViewFilterdata. The 42 patients
    // );

    const resourcesForEntireStudy = await getResourceDataOfEntireStudy(
        // The studyViewFilterdata. The 42 patients, do we still need this if we only need the study id? Yes, we need to filter down to only these patients
        studyClinicalDataResponse.data
    );
    console.log('resourcesForEntireStudy', resourcesForEntireStudy);

    const reduced = resourcesForEntireStudy.reduce(
        (map: { [key: string]: ResourceData[] }, resource) => {
            if (resource.resourceDefinition.resourceType == 'PATIENT') {
                if (map.hasOwnProperty(resource.patientId)) {
                    map[resource.patientId].push(resource);
                } else {
                    map[resource.patientId] = [resource];
                }
            } else if (resource.resourceDefinition.resourceType == 'SAMPLE') {
                if (map.hasOwnProperty(resource.sampleId)) {
                    map[resource.sampleId].push(resource);
                } else {
                    map[resource.sampleId] = [resource];
                }
            }

            return map;
        },
        {}
    );
    console.log('Reduced', reduced);

    // console.log("resourcesForPatients", resourcesForPatients);

    // const resourcesForPatientsAndSamples: { [key: string]: ResourceData[] } = {
    //     ...sampleIdResourceData,
    //     ...resourcesForPatients,
    // };

    // we create objects with the necessary properties for each resource
    // calculate the total number of resources per patient.
    // console.log("resourcesForPatientsAndSamples", resourcesForPatientsAndSamples);
    const { resourcesPerPatient, items } = buildItemsAndResources(
        // resourcesForPatientsAndSamples
        reduced
    );

    // set the number of resources available per patient.
    _.forEach(items, item => {
        item.resourcesPerPatient = resourcesPerPatient[item.patientId];
    });

    // there is a requirement to sort initially by 'resourcesPerPatient' field
    // in descending order.
    const sortedData = _.orderBy(items, 'resourcesPerPatient', 'desc');
    return {
        totalItems: sortedData.length,
        data: _.values(sortedData),
    };
}

@observer
export class FilesAndLinks extends React.Component<IFilesLinksTable, {}> {
    constructor(props: IFilesLinksTable) {
        super(props);
        makeObservable(this);
    }

    getDefaultColumnConfig(
        key: string,
        columnName: string,
        isNumber?: boolean
    ) {
        return {
            name: columnName || '',
            headerRender: (data: string) => (
                <span data-test={data}>{data}</span>
            ),
            render: (data: { [id: string]: string }) => {
                if (isUrl(data[key])) {
                    return (
                        <a href={data[key]} target="_blank">
                            {data[key]}
                        </a>
                    );
                }
                return <span data-test={data[key]}>{data[key]}</span>;
            },
            download: (data: { [id: string]: string }) => data[key] || '',
            sortBy: (data: { [id: string]: any }) => {
                if (data[key]) {
                    return data[key];
                }
                return null;
            },
            filter: (
                data: { [id: string]: string },
                filterString: string,
                filterStringUpper: string
            ) => {
                if (data[key]) {
                    if (!isNumber) {
                        return (data[key] || '')
                            .toUpperCase()
                            .includes(filterStringUpper);
                    }
                }
                return false;
            },
        };
    }

    @observable searchTerm: string | undefined = undefined;

    readonly resourceData = remoteData({
        await: () => [
            this.props.store.selectedSamples,
            this.props.store.resourceDefinitions,
            // this.props.store.sampleResourceData,
        ],
        onError: () => {},
        invoke: async () => {
            if (this.props.store.selectedSamples.result.length === 0) {
                return Promise.resolve({ totalItems: 0, data: [] });
            }

            const resources = await fetchFilesLinksData(
                this.props.store.filters,
                // this.props.store.sampleResourceData.result!,
                this.searchTerm,
                'patientId',
                'asc',
                RECORD_LIMIT
            );
            return Promise.resolve(resources);
        },
    });

    @computed get columns() {
        let defaultColumns: Column<{ [id: string]: any }>[] = [
            {
                ...this.getDefaultColumnConfig('patientId', 'Patient ID'),
                render: (data: { [id: string]: string }) => {
                    return (
                        <a
                            href={getPatientViewUrlWithPathname(
                                data.studyId,
                                data.patientId,
                                'patient/filesAndLinks'
                            )}
                            target="_blank"
                        >
                            {data.patientId}
                        </a>
                    );
                },
            },

            {
                ...this.getDefaultColumnConfig('sampleId', 'Sample ID'),
                render: (data: { [id: string]: string }) => {
                    return (
                        <a
                            href={getSampleViewUrlWithPathname(
                                data.studyId,
                                data.sampleId,
                                'patient/filesAndLinks'
                            )}
                            target="_blank"
                        >
                            {data.sampleId}
                        </a>
                    );
                },
            },

            {
                ...this.getDefaultColumnConfig(
                    'typeOfResource',
                    'Type Of Resource'
                ),
                render: (data: { [id: string]: string }) => {
                    const path = `patient/openResource_${data.resourceId}`;
                    return (
                        <div>
                            <a
                                href={getResourceViewUrlWithPathname(
                                    data.studyId,
                                    path,
                                    data.patientId
                                )}
                            >
                                {data.typeOfResource}
                            </a>
                        </div>
                    );
                },
            },

            {
                ...this.getDefaultColumnConfig('resourceUrl', ''),
                render: (data: { [id: string]: string }) => {
                    return (
                        <div>
                            <a
                                href={data.url}
                                style={{ fontSize: 10 }}
                                target={'_blank'}
                            >
                                <i
                                    className={`fa fa-external-link fa-sm`}
                                    style={{
                                        marginRight: 5,
                                        color: 'black',
                                    }}
                                />
                                Open in new window
                            </a>
                        </div>
                    );
                },
            },

            {
                ...this.getDefaultColumnConfig('description', 'Description'),
                render: (data: { [id: string]: string }) => {
                    return <div>{data.description}</div>;
                },
            },

            {
                ...this.getDefaultColumnConfig(
                    'resourcesPerPatient',
                    'Resources per Patient',
                    true
                ),
                render: (data: { [id: string]: number }) => {
                    return <div>{data.resourcesPerPatient}</div>;
                },
            },
        ];

        return defaultColumns;
    }

    public render() {
        return (
            <span data-test="files-links-data-content">
                <WindowWidthBox offset={60}>
                    <If condition={this.resourceData.isPending}>
                        <Then>
                            <LoadingIndicator
                                isLoading={true}
                                size={'big'}
                                center={true}
                            />
                        </Then>
                        <Else>
                            <FilesLinksTableComponent
                                initialItemsPerPage={20}
                                headerComponent={
                                    <div className={'positionAbsolute'}>
                                        <strong>
                                            {
                                                this.resourceData.result
                                                    ?.totalItems
                                            }{' '}
                                            resources
                                        </strong>
                                    </div>
                                }
                                data={this.resourceData.result?.data || []}
                                columns={this.columns}
                                showColumnVisibility={false}
                                showCountHeader={false}
                                showFilterClearButton={false}
                                showCopyDownload={false}
                                initialSortColumn={'resourcesPerPatient'}
                                initialSortDirection={'desc'}
                            />
                        </Else>
                    </If>
                </WindowWidthBox>
            </span>
        );
    }
}
