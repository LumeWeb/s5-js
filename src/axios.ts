import Axios, { AxiosRequestConfig } from "axios";

export const customInstance = <T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig,
): Promise<T> => {
  const source = Axios.CancelToken.source();

  /*
    Hack to ensure that the data is passed to the request as an option.
     */
  if (options?.data) {
    config = config || {};
    config.data = options.data;
    delete config.data;
  }

  const instance = Axios.create({ baseURL: options?.baseURL });
  const promise = instance({
    ...config,
    ...options,
    cancelToken: source.token,
  }).then(({ data }) => data);

  // @ts-ignore
  promise.cancel = () => {
    source.cancel("Query was cancelled");
  };

  return promise;
};
