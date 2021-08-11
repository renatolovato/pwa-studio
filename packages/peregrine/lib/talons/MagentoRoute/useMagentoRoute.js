import { useCallback, useEffect, useState, useRef } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useLazyQuery } from '@apollo/client';
import { useRootComponents } from '@magento/peregrine/lib/context/rootComponents';
import mergeOperations from '@magento/peregrine/lib/util/shallowMerge';
import { useAppContext } from '../../context/app';

import { getRootComponent, isRedirect } from './helpers';
import DEFAULT_OPERATIONS from './magentoRoute.gql';

const getInlinedPageData = () => {
    return globalThis.INLINED_PAGE_TYPE && globalThis.INLINED_PAGE_TYPE.type
        ? globalThis.INLINED_PAGE_TYPE
        : null;
};

const getComponentData = (routeData) => {
    const excludedKeys = ['redirect_code', 'relative_url'];

    return Object.fromEntries(
        Object.entries(routeData).filter(([key]) => {
            return !excludedKeys.includes(key);
        })
    );
};

export const useMagentoRoute = (props = {}) => {
    const operations = mergeOperations(DEFAULT_OPERATIONS, props.operations);
    const { resolveUrlQuery } = operations;
    const { replace } = useHistory();
    const { pathname } = useLocation();
    const [componentMap, setComponentMap] = useRootComponents();
    const [previousPathname, setPreviousPathname] = useState(null);
    const initialized = useRef(false);
    const fetchedPathname = useRef(null);
    const fetching = useRef(false);

    const [
        { nextRootComponent },
        {
            actions: { setNextRootComponent, setPageLoading }
        }
    ] = useAppContext();

    const setComponent = useCallback(
        (key, value) => {
            setComponentMap(prevMap => new Map(prevMap).set(key, value));
        },
        [setComponentMap]
    );

    const component = componentMap.get(pathname);
    const previousComponent = previousPathname
        ? componentMap.get(previousPathname)
        : null;

    const [runQuery, queryResult] = useLazyQuery(resolveUrlQuery, {
        onCompleted: async ({ route }) => {
            fetching.current = false;
            if (!component) {
                const { type, ...routeData } = route || {};
                try {
                    const rootComponent = await getRootComponent(type);
                    setComponent(pathname, {
                        component: rootComponent,
                        ...getComponentData(routeData),
                        type
                    });
                } catch (error) {
                    setComponent(pathname, error);
                }
            }
        },
        onError: () => {
            fetching.current = false;
        }
    });

    useEffect(() => {
        if (initialized.current || !getInlinedPageData()) {
            fetching.current = true;
            runQuery({
                fetchPolicy: 'cache-and-network',
                nextFetchPolicy: 'cache-first',
                variables: { url: pathname }
            });
            fetchedPathname.current = pathname;
        }
    }, [initialized, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

    // destructure the query result
    const { data, error } = queryResult;
    const { route } = data || {};
    const { id, redirect_code, relative_url, type } = route || {};

    // evaluate both results and determine the response type
    const empty = !route || !type || id < 1;
    const redirect = isRedirect(redirect_code);
    const fetchError = component instanceof Error && component;
    const routeError = fetchError || error;
    const previousFetchError = previousComponent instanceof Error;
    const isInitialized = initialized.current || !getInlinedPageData();
    let showPageLoader = false;
    let routeData;

    if (component && !fetchError) {
        // FOUND
        routeData = component;
    } else if (routeError) {
        // ERROR
        routeData = { hasError: true, routeError };
    } else if (redirect) {
        // REDIRECT
        routeData = {
            isRedirect: true,
            relativeUrl: relative_url.startsWith('/')
                ? relative_url
                : '/' + relative_url
        };
    } else if (empty && fetchedPathname.current === pathname && !fetching.current) {
        // NOT FOUND
        routeData = { isNotFound: true };
    } else if (nextRootComponent) {
        // LOADING with full page shimmer
        showPageLoader = true;
        routeData = { isLoading: true, shimmer: nextRootComponent };
    } else if (previousComponent && !previousFetchError) {
        // LOADING with previous component
        showPageLoader = true;
        routeData = { isLoading: true, ...previousComponent };
    } else {
        // LOADING
        const isInitialLoad = !isInitialized;
        routeData = { isLoading: true, initial: isInitialLoad };
    }

    useEffect(() => {
        (async () => {
            const inlinedData = getInlinedPageData();
            if (inlinedData) {
                try {
                    const componentType = inlinedData.type;
                    const rootComponent = await getRootComponent(componentType);
                    setComponent(pathname, {
                        component: rootComponent,
                        type: componentType,
                        ...getComponentData(inlinedData)
                    });
                } catch (error) {
                    setComponent(pathname, error);
                }
            }
            initialized.current = true;
        })();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // perform a redirect if necesssary
    useEffect(() => {
        if (routeData && routeData.isRedirect) {
            replace(routeData.relativeUrl);
        }
    }, [pathname, replace, routeData]);

    useEffect(() => {
        if (component) {
            // store previous component's path
            setPreviousPathname(pathname);
            // Reset loading shimmer whenever component resolves
            setNextRootComponent(null);
        }
    }, [component, pathname, setNextRootComponent, setPreviousPathname]);

    useEffect(() => {
        setPageLoading(showPageLoader);
    }, [showPageLoader, setPageLoading]);

    return routeData;
};
