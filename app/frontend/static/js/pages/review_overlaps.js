import {mountOverlapReview} from '../features/preview/overlaps.js';
import {Lifecycle,startPage} from '../lifecycle.js';
import {createHttp} from '../http.js';
/** Own the retained review page's requests, listeners and map lifecycle. */
function createReviewPage(){
 const scope=new Lifecycle();
 return {mount(){mountOverlapReview({scope,http:createHttp(scope)});},dispose:()=>scope.dispose()};
}
startPage(createReviewPage);
